"""
after_train.py: Retrain the existing finetuned model using corrected user examples from app.py.

This script:
1. Loads the finetuned model saved by init_train.py
2. Reads user-corrected examples (toxic -> detoxified pairs)
3. Retrains the model on this new data with lower learning rate (fine-tuning mode)
4. Saves the improved model back to the same checkpoint directory
"""

import os
import json
import torch
import pandas as pd
from datasets import Dataset
from transformers import (
    AutoTokenizer,
    AutoModelForSeq2SeqLM,
    Trainer,
    Seq2SeqTrainingArguments,
    DataCollatorForSeq2Seq,
    TrainerCallback,
)

# === Confirm GPU availability ===
print("Using GPU:", torch.cuda.is_available())

# === Custom callback to log metrics ===
class MetricsLoggerCallback(TrainerCallback):
    def __init__(self, log_path="after_train_metrics.txt"):
        self.log_path = log_path

    def on_log(self, args, state, control, logs=None, **kwargs):
        if logs is None:
            return
        with open(self.log_path, "a") as f:
            if "loss" in logs:
                f.write(f"Step {state.global_step} - Loss: {logs['loss']:.4f}\n")


# === Paths and model setup ===
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "t5-small-detox-finetuned")
CORRECTIONS_FILE = os.path.join(SCRIPT_DIR, "user_corrections.json")  # From app.py
MAX_LENGTH = 128

print(f"Script directory: {SCRIPT_DIR}")
print(f"Loading model from: {OUTPUT_DIR}")

# Load the EXISTING finetuned model (not base t5-small)
if not os.path.exists(OUTPUT_DIR):
    raise RuntimeError(f"Finetuned model not found at {OUTPUT_DIR}. Run init_train.py first.")

tokenizer = AutoTokenizer.from_pretrained(OUTPUT_DIR)
model = AutoModelForSeq2SeqLM.from_pretrained(OUTPUT_DIR)
print(f"Loaded pretrained model from {OUTPUT_DIR}")


# === Load user ratings ===
def load_user_ratings(ratings_file="user_ratings.json"):
    """
    Load rated examples from app.py.
    Prioritize 5-star ratings, skip 1-star ratings (likely bad detoxifications).
    Expected format: JSON file with list of {"toxic": "...", "detoxified": "...", "rating": N} pairs
    """
    rows_5star = []
    rows_other = []
    
    ratings_path = os.path.join(SCRIPT_DIR, ratings_file)
    
    if os.path.exists(ratings_path):
        print(f"Loading user ratings from {ratings_path}...")
        try:
            with open(ratings_path, "r") as f:
                ratings = json.load(f)
            
            if isinstance(ratings, list):
                for item in ratings:
                    toxic = str(item.get("toxic", "")).strip()
                    detoxified = str(item.get("detoxified", "")).strip()
                    rating = int(item.get("rating", 0))
                    
                    if toxic and detoxified and rating > 0:
                        pair = {"toxic": toxic, "neutral": detoxified}
                        
                        if rating == 5:
                            # Prioritize 5-star: add multiple times for emphasis
                            rows_5star.extend([pair] * 3)
                        elif rating > 1:
                            # Include 2-4 stars once
                            rows_other.append(pair)
                        # Skip 1-star (rating == 1)
            
            # Combine: 5-star examples first (duplicated for emphasis), then others
            rows = rows_5star + rows_other
            print(f"Loaded {len(rows_5star)//3} five-star examples, {len(rows_other)} other examples (skipped 1-star)")
        except Exception as e:
            print(f"Error loading ratings file: {e}")
            rows = []
    else:
        print(f"Warning: {ratings_path} not found. No user ratings to apply.")
        rows = []
    
    return pd.DataFrame(rows)


df_corrections = load_user_ratings()

if len(df_corrections) == 0:
    print("No user corrections found. Skipping retraining.")
    exit(0)

dataset = Dataset.from_pandas(df_corrections.reset_index(drop=True))


# === Tokenization with proper label padding (-100) ===
def tokenize_function(examples):
    inputs = examples["toxic"]
    targets = examples["neutral"]
    model_inputs = tokenizer(inputs, max_length=MAX_LENGTH, truncation=True, padding="max_length")

    # Tokenize targets and set -100 for padding tokens so they are ignored by loss
    labels = tokenizer(targets, max_length=MAX_LENGTH, truncation=True, padding="max_length", text_target=targets)
    
    label_ids = labels["input_ids"]
    # replace pad token id's with -100
    label_ids = [[(l if l != tokenizer.pad_token_id else -100) for l in seq] for seq in label_ids]
    model_inputs["labels"] = label_ids
    return model_inputs


tokenized = dataset.map(tokenize_function, batched=True, remove_columns=dataset.column_names)


# === Data collator ===
data_collator = DataCollatorForSeq2Seq(tokenizer=tokenizer, model=model)


# === Training arguments (fine-tuning mode: lower LR, fewer epochs, no eval split) ===
training_args = Seq2SeqTrainingArguments(
    output_dir=OUTPUT_DIR,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=2,  # effective batch size 8
    learning_rate=1e-05,  # Lower LR for fine-tuning on user corrections
    weight_decay=0.01,
    num_train_epochs=2,  # Just 2 epochs on user corrections (they're high-quality)
    logging_steps=10,
    eval_strategy="no",  # No evaluation split on small user-corrected dataset
    save_strategy="epoch",
    save_total_limit=1,
    predict_with_generate=True,
    fp16=torch.cuda.is_available(),
    remove_unused_columns=True,
    push_to_hub=False,
)


# === Trainer setup ===
trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=tokenized,
    eval_dataset=None,
    data_collator=data_collator,
    tokenizer=tokenizer,
    callbacks=[MetricsLoggerCallback()]
)


if __name__ == "__main__":
    print(f"Starting fine-tuning with {len(tokenized)} user-corrected samples...")
    trainer.train()
    trainer.save_model(OUTPUT_DIR)
    tokenizer.save_pretrained(OUTPUT_DIR)
    print("Fine-tuning complete. Model saved to", OUTPUT_DIR)
