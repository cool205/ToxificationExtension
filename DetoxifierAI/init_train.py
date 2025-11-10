import os
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
    # EarlyStoppingCallback removed per user request (no early stopping)
)

# === Confirm GPU availability ===
print("Using GPU:", torch.cuda.is_available())

# === Custom callback to log metrics ===
class MetricsLoggerCallback(TrainerCallback):
    def __init__(self, log_path="metrics_log.txt"):
        self.log_path = log_path

    def on_log(self, args, state, control, logs=None, **kwargs):
        if logs is None:
            return
        with open(self.log_path, "a") as f:
            if "loss" in logs:
                f.write(f"Step {state.global_step} - Loss: {logs['loss']:.4f}\n")

# === Paths and model setup ===
MODEL_NAME = os.environ.get("BASE_MODEL", "t5-small")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "t5-small-detox-finetuned")
MAX_LENGTH = 128

print(f"Script directory: {SCRIPT_DIR}")
print(f"Output directory: {OUTPUT_DIR}")

tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME)


# === Load and prepare datasets ===
def load_paradetox(main_tsv="paradetox.tsv", cannot_rewrite_tsv="paradetox_cannot_rewrite.tsv"):
    # Use absolute paths
    main_tsv_path = os.path.join(SCRIPT_DIR, main_tsv)
    cannot_rewrite_tsv_path = os.path.join(SCRIPT_DIR, cannot_rewrite_tsv)
    
    rows = []
    if os.path.exists(main_tsv_path):
        print(f"Loading {main_tsv_path}...")
        df = pd.read_csv(main_tsv_path, sep="\t", dtype=str).fillna("")
        for _, r in df.iterrows():
            toxic = str(r.get("toxic", "") or "").strip()
            for col in ["neutral1", "neutral2", "neutral3"]:
                neutral = str(r.get(col, "") or "").strip()
                if toxic and neutral:
                    rows.append({"toxic": toxic, "neutral": neutral})
    else:
        print(f"Warning: {main_tsv_path} not found")

    if os.path.exists(cannot_rewrite_tsv_path):
        print(f"Loading {cannot_rewrite_tsv_path}...")
        df2 = pd.read_csv(cannot_rewrite_tsv_path, sep="\t", dtype=str).fillna("")
        for _, r in df2.iterrows():
            toxic = str(r.get("toxic", "") or "").strip()
            if toxic:
                rows.append({"toxic": toxic, "neutral": "none"})
    else:
        print(f"Warning: {cannot_rewrite_tsv_path} not found")

    return pd.DataFrame(rows)


df_all = load_paradetox()
print(f"Loaded {len(df_all)} training pairs")

if len(df_all) == 0:
    raise RuntimeError("No training data found. Make sure paradetox.tsv and paradetox_cannot_rewrite.tsv are in the same directory as this script.")

dataset = Dataset.from_pandas(df_all.reset_index(drop=True))


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


# === Train/validation split ===
split = tokenized.train_test_split(test_size=0.05, seed=42)
train_ds = split["train"]
eval_ds = split["test"]


# === Data collator ===
data_collator = DataCollatorForSeq2Seq(tokenizer=tokenizer, model=model)


# === Training arguments (improved hyperparameters) ===
training_args = Seq2SeqTrainingArguments(
    output_dir=OUTPUT_DIR,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=2,  # effective batch size 8
    learning_rate=3e-05,
    weight_decay=0.01,
    num_train_epochs=10, 
    logging_steps=50,
    eval_strategy="steps",  # Changed from evaluation_strategy
    eval_steps=200,
    save_steps=500,
    save_total_limit=3,
    predict_with_generate=True,
    fp16=torch.cuda.is_available(),
    remove_unused_columns=True,
    push_to_hub=False,
)


# === Trainer setup ===
trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=train_ds,
    eval_dataset=eval_ds,
    data_collator=data_collator,
    tokenizer=tokenizer,
    callbacks=[MetricsLoggerCallback()]
)


if __name__ == "__main__":
    # Small sanity check before training
    if len(train_ds) == 0:
        raise RuntimeError("No training data found. Make sure paradetox files are present and have content.")

    print(f"Starting training with {len(train_ds)} training samples and {len(eval_ds)} eval samples...")
    trainer.train()
    trainer.save_model(OUTPUT_DIR)
    tokenizer.save_pretrained(OUTPUT_DIR)
    print("Training complete. Model saved to", OUTPUT_DIR)
