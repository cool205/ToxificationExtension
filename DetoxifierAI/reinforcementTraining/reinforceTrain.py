import json
from datasets import load_dataset
from transformers import (
    AutoModelForSeq2SeqLM,
    AutoTokenizer,
    TrainingArguments
)
from trl import DPOTrainer, DPOConfig
import os

def prepare_record(example):
    toxic = example["toxic"]
    chosen = example["chosen"]
    rejected = example["rejected"]
    example["input_text"] = f"detoxify: {toxic}"
    if chosen == "UNTOXIFIABLE":
        example["chosen_text"] = "detoxify: UNTOXIFIABLE"
        if isinstance(rejected, list) and len(rejected) > 0:
            example["rejected_text"] = rejected[0]
        else:
            example["rejected_text"] = "detoxify: UNTOXIFIABLE"
        return example
    example["chosen_text"] = chosen
    if isinstance(rejected, list) and len(rejected) > 0:
        example["rejected_text"] = rejected[0]
    else:
        example["rejected_text"] = chosen
    return example

def filter_valid(example):
    if (
        "input_text" not in example or
        "chosen_text" not in example or
        "rejected_text" not in example
    ):
        return False
    if example["input_text"].strip() == "":
        return False
    if example["chosen_text"].strip() == "":
        return False
    if example["rejected_text"].strip() == "":
        return False
    return True

def main():
    json_path = "DetoxifierAI/user_preferences.json"
    model_folder = "DetoxifierAI/seq2seq-detox-finetuned"
    dataset = load_dataset("json", data_files=json_path)["train"]
    dataset = dataset.map(prepare_record)
    dataset = dataset.filter(filter_valid)
    print("Dataset size after cleaning:", len(dataset))
    tokenizer = AutoTokenizer.from_pretrained(model_folder)
    model = AutoModelForSeq2SeqLM.from_pretrained(model_folder)
    ref_model = AutoModelForSeq2SeqLM.from_pretrained(model_folder)
    dataset = dataset.remove_columns(["chosen", "rejected"])

    # Now safely rename
    dataset = dataset.rename_columns({
        "input_text": "prompt",
        "chosen_text": "chosen",
        "rejected_text": "rejected"
    })

    train_dataset = dataset
    training_args = DPOConfig(
        output_dir=model_folder,
        per_device_train_batch_size=2,
        learning_rate=1e-5,
        num_train_epochs=1,
        logging_steps=5,
        save_steps=50,
        save_total_limit=1,
        bf16=False,
        fp16=True,
    )
    trainer = DPOTrainer(
        model=model,
        ref_model=ref_model,
        args=training_args,
        train_dataset=train_dataset,
    )

    trainer.train()
    trainer.model.save_pretrained(model_folder)
    tokenizer.save_pretrained(model_folder)
    print("Training complete. Model updated in folder:", model_folder)

if __name__ == "__main__":
    main()
