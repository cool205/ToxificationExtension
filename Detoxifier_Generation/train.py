from transformers import AutoTokenizer, AutoModelForSeq2SeqLM, Trainer, TrainingArguments, DataCollatorForSeq2Seq
from datasets import load_dataset
import torch

# Load ParaGeDi detox model
model_name = "s-nlp/bart-base-detox"
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForSeq2SeqLM.from_pretrained(model_name)

# Load your dataset
dataset = load_dataset("json", data_files="feedback/train.jsonl", split="train")

# Preprocess: extract input (toxic) and target (neutral) from "text" field
def preprocess(example):
    text = example["text"]
    
    # Check and parse "Toxic Version" and "Neutral Version"
    if "Toxic Version:" in text and "Neutral Version:" in text:
        toxic_part = text.split("Toxic Version:")[1].split("Neutral Version:")[0].strip()
        neutral_part = text.split("Neutral Version:")[1].strip()
        
        # Tokenize toxic input and neutral target
        model_input = tokenizer(toxic_part, truncation=True, padding="max_length", max_length=512)
        with tokenizer.as_target_tokenizer():
            model_input["labels"] = tokenizer(neutral_part, truncation=True, padding="max_length", max_length=512)["input_ids"]
        return model_input
    else:
        return {}

# Apply preprocessing
tokenized_dataset = dataset.map(preprocess, remove_columns=dataset.column_names)

# Training arguments
training_args = TrainingArguments(
    output_dir="./paragedi-detox-finetuned",
    per_device_train_batch_size=2,
    num_train_epochs=3,
    logging_dir="./logs",
    save_steps=500,
    save_total_limit=2,
    fp16=torch.cuda.is_available()
)

# Trainer setup
trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=tokenized_dataset,
    tokenizer=tokenizer,
    data_collator=DataCollatorForSeq2Seq(tokenizer=tokenizer, model=model)
)

# Train the model
trainer.train()
