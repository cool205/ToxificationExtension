"""
after_train.py — Reinforcement Learning via DPO using user preferences.

This script:
1. Loads the supervised detoxifier (from init_train.py)
2. Loads user preference data (chosen vs rejected detoxifications)
3. Fine-tunes the model using Direct Preference Optimization (DPO)
4. Saves the updated model back to the same checkpoint directory
"""

import os
import json
import torch
from pathlib import Path
from datasets import Dataset
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
from trl import DPOTrainer, DPOConfig

# === Paths ===
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Check if running from DetoxifierAI or reinforcementTraining folder
if os.path.exists(os.path.join(SCRIPT_DIR, "reinforcementTraining")):
    # Running from parent DetoxifierAI folder
    MODEL_DIR = os.path.join(SCRIPT_DIR, "reinforcementTraining", "t5-small-detox-finetuned")
    PREFS_FILE = os.path.join(SCRIPT_DIR, "reinforcementTraining", "user_preferences.json")
else:
    # Running from reinforcementTraining folder
    MODEL_DIR = os.path.join(SCRIPT_DIR, "t5-small-detox-finetuned")
    PREFS_FILE = os.path.join(SCRIPT_DIR, "user_preferences.json")

print(f"Script directory: {SCRIPT_DIR}")
print(f"Model directory: {MODEL_DIR}")
print(f"Preferences file: {PREFS_FILE}")

# === Load tokenizer and model ===
if not os.path.exists(MODEL_DIR):
    raise RuntimeError(f"Model not found at {MODEL_DIR}. Run init_train.py first.")

tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)
model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_DIR)
print(f"Loaded model from {MODEL_DIR}")

# === Load user preference pairs ===
def load_preferences(path):
    """Load preference data: {toxic, chosen, rejected}"""
    if not os.path.exists(path):
        raise FileNotFoundError(f"Preference file not found: {path}")
    
    with open(path, "r") as f:
        data = json.load(f)
    
    rows = []
    for item in data:
        toxic = str(item.get("toxic", "")).strip()
        chosen = str(item.get("chosen", "")).strip()
        rejected_list = item.get("rejected", [])
        
        if toxic and chosen and rejected_list:
            # For DPO, we need prompt, chosen, rejected
            # Take first rejected option or combine all
            rejected = rejected_list[0] if isinstance(rejected_list, list) else rejected_list
            rejected = str(rejected).strip()
            
            if rejected:
                rows.append({
                    "prompt": toxic,
                    "chosen": chosen,
                    "rejected": rejected
                })
    
    return Dataset.from_list(rows)

print(f"Loading preferences from {PREFS_FILE}...")
dataset = load_preferences(PREFS_FILE)
print(f"Loaded {len(dataset)} preference pairs.")

if len(dataset) == 0:
    print("No preference data to train on. Exiting.")
    exit(0)

# === DPO config ===
config = DPOConfig(
    output_dir=MODEL_DIR,
    learning_rate=1e-6,  # Very low LR for fine-tuning
    per_device_train_batch_size=4,
    num_train_epochs=2,
    logging_steps=5,
    save_strategy="epoch",
    save_total_limit=1,
    remove_unused_columns=False,
    push_to_hub=False,
    bf16=torch.cuda.is_available() and torch.cuda.get_device_capability()[0] >= 8,  # BF16 if available
    fp16=torch.cuda.is_available() and not (torch.cuda.get_device_capability()[0] >= 8),  # FP16 otherwise
)

# === DPO trainer ===
trainer = DPOTrainer(
    model=model,
    ref_model=None,  # Optional: use a frozen reference model
    args=config,
    beta=0.1,  # Strength of preference loss
    tokenizer=tokenizer,
    train_dataset=dataset,
    eval_dataset=None,
)

# === Run training ===
if __name__ == "__main__":
    print("Starting DPO fine-tuning with user preferences...")
    trainer.train()
    trainer.save_model(MODEL_DIR)
    tokenizer.save_pretrained(MODEL_DIR)
    print("DPO fine-tuning complete. Model saved to", MODEL_DIR)