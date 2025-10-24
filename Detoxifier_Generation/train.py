import torch
import pandas as pd
from datasets import Dataset
from transformers import (
    AutoTokenizer,
    AutoModelForSeq2SeqLM,
    Trainer,
    TrainingArguments,
    DataCollatorForSeq2Seq,
    TrainerCallback
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
            if "eval_accuracy" in logs:
                f.write(f"Step {state.global_step} - Accuracy: {logs['eval_accuracy']:.4f}\n")

# === Load model and tokenizer ===
model_name = "t5-small"
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForSeq2SeqLM.from_pretrained(model_name)

# === Load and reshape dataset ===
train_df = pd.read_csv("paradetox.tsv", sep="\t")
train_df = train_df.dropna(subset=["toxic", "neutral1", "neutral2", "neutral3"])

# Reshape to long format: one toxic-neutral pair per row
train_df_long = train_df.melt(
    id_vars=["toxic"],
    value_vars=["neutral1", "neutral2", "neutral3"],
    var_name="neutral_variant",
    value_name="neutral"
)

# Convert to HuggingFace Dataset
dataset = Dataset.from_pandas(train_df_long)

# === Tokenization ===
def tokenize_function(examples):
    inputs = examples["toxic"]
    targets = examples["neutral"]
    model_inputs = tokenizer(inputs, max_length=128, truncation=True, padding="max_length")
    labels = tokenizer(targets, max_length=128, truncation=True, padding="max_length")
    model_inputs["labels"] = labels["input_ids"]
    return model_inputs

tokenized_datasets = dataset.map(tokenize_function, batched=True)

# === Data collator for padding ===
data_collator = DataCollatorForSeq2Seq(tokenizer=tokenizer, model=model)

# === Training arguments ===
training_args = TrainingArguments(
    output_dir="./t5-small-detox-finetuned",
    learning_rate=5e-5,
    per_device_train_batch_size=8,
    weight_decay=0.01,
    num_train_epochs=5,
    logging_steps=10,
    disable_tqdm=False  # disables console progress bar
)

# === Trainer ===
trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=tokenized_datasets,
    data_collator=data_collator,
    callbacks=[MetricsLoggerCallback()]
)

# === Train and save ===
trainer.train()
trainer.save_model("./t5-small-detox-finetuned")
tokenizer.save_pretrained("./t5-small-detox-finetuned")