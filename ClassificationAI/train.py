#!/usr/bin/env python3
"""
Train a text classification model using a CSV file.

Usage (PowerShell example):
python .\classificationAI\train.py --data_file .\data\classificationDataset_cleaned.csv --output_dir .\t5-small-detox-finetuned --model_name_or_path distilbert-base-uncased --num_train_epochs 3

The script expects the CSV to have at least a `text` column and a `label` column.
It will create `output_dir` with the trained model and tokenizer, and will write a per-epoch text file
with predictions for the evaluation set named `epoch_{epoch:03}.txt` inside `output_dir`.

Requirements (install in your environment):
pip install "transformers>=4.0.0" datasets pandas scikit-learn torch

"""
import os
import argparse
import math
from pathlib import Path
import pandas as pd
import numpy as np
from datasets import Dataset, DatasetDict
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
import torch
from transformers import (
    AutoTokenizer,
    AutoConfig,
    AutoModelForSequenceClassification,
    TrainingArguments,
    Trainer,
    EvalPrediction,
    TrainerCallback,
)
import torch.nn.functional as F


class EpochPredictionLogger(TrainerCallback):
    """Writes a per-epoch prediction file for the evaluation dataset.

    The callback is triggered on evaluation and writes a file named epoch_{epoch:03}.txt
    to the Trainer's output directory. Each line contains: index \t gold_label \t pred_label \t score \t text
    """

    def on_evaluate(self, args, state, control, **kwargs):
        trainer = kwargs.get("trainer")
        if trainer is None:
            return

        # Determine epoch number
        epoch = int(state.epoch) if state.epoch is not None else int(state.global_step)
        out_dir = Path(trainer.args.output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        file_path = out_dir / f"epoch_{int(epoch):03}.txt"

        eval_dataset = trainer.eval_dataset
        if eval_dataset is None:
            return

        # Get predictions
        preds_output = trainer.predict(eval_dataset)
        logits = preds_output.predictions
        if isinstance(logits, tuple):
            logits = logits[0]
        probs = F.softmax(torch.tensor(logits), dim=1).numpy()
        preds = np.argmax(probs, axis=1)

        # Try to fetch texts and labels
        texts = eval_dataset["text"] if "text" in eval_dataset.column_names else None
        labels = eval_dataset["label"] if "label" in eval_dataset.column_names else None

        # If label mapping exists on the trainer, use it
        label_list = None
        if hasattr(trainer.model.config, "id2label"):
            id2label = trainer.model.config.id2label
            label_list = [id2label[i] for i in range(len(id2label))]

        with open(file_path, "w", encoding="utf-8") as f:
            for i, pred in enumerate(preds):
                gold = labels[i] if labels is not None else ""
                text = texts[i] if texts is not None else ""
                score = float(np.max(probs[i]))
                pred_label = label_list[pred] if label_list is not None else str(int(pred))
                gold_label = label_list[gold] if (label_list is not None and isinstance(gold, (int, np.integer))) else str(gold)
                f.write(f"{i}\t{gold_label}\t{pred_label}\t{score:.6f}\t{text.replace('\n',' ')[:1000]}\n")

        print(f"Wrote epoch predictions to {file_path}")


def preprocess_function(examples, tokenizer, text_column: str, max_length: int):
    return tokenizer(examples[text_column], truncation=True, padding="max_length", max_length=max_length)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data_file", type=str, required=True, help="Path to CSV with columns 'text' and 'label'")
    parser.add_argument("--output_dir", type=str, default="./t5-small-detox-finetuned", help="Where to save the model and logs")
    parser.add_argument("--model_name_or_path", type=str, default="distilbert-base-uncased")
    parser.add_argument("--per_device_train_batch_size", type=int, default=8)
    parser.add_argument("--per_device_eval_batch_size", type=int, default=16)
    parser.add_argument("--num_train_epochs", type=int, default=3)
    parser.add_argument("--learning_rate", type=float, default=5e-5)
    parser.add_argument("--max_length", type=int, default=256)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--eval_size", type=float, default=0.1)
    args = parser.parse_args()

    # Read CSV
    df = pd.read_csv(args.data_file)
    if "text" not in df.columns or "label" not in df.columns:
        raise ValueError("CSV must contain 'text' and 'label' columns")

    # Simple label encoding
    le = LabelEncoder()
    df = df.dropna(subset=["text", "label"]).reset_index(drop=True)
    df["label"] = le.fit_transform(df["label"])  # integer labels
    label_names = list(le.classes_)

    train_df, eval_df = train_test_split(df, test_size=args.eval_size, random_state=args.seed, stratify=df["label"])

    # Convert to datasets
    train_ds = Dataset.from_pandas(train_df)
    eval_ds = Dataset.from_pandas(eval_df)
    dataset = DatasetDict({"train": train_ds, "validation": eval_ds})

    # Tokenizer and model
    tokenizer = AutoTokenizer.from_pretrained(args.model_name_or_path, use_fast=True)

    config = AutoConfig.from_pretrained(
        args.model_name_or_path,
        num_labels=len(label_names),
        id2label={i: l for i, l in enumerate(label_names)},
        label2id={l: i for i, l in enumerate(label_names)},
    )

    model = AutoModelForSequenceClassification.from_config(config)

    # Tokenize
    def tok_fn(ex):
        return preprocess_function(ex, tokenizer, text_column="text", max_length=args.max_length)

    dataset = dataset.map(tok_fn, batched=True, remove_columns=[c for c in dataset["train"].column_names if c not in ["label", "text", "input_ids", "attention_mask"]])

    # Set format for PyTorch
    dataset.set_format(type="torch", columns=["input_ids", "attention_mask", "label"])

    # Training args
    training_args = TrainingArguments(
        output_dir=args.output_dir,
        num_train_epochs=args.num_train_epochs,
        per_device_train_batch_size=args.per_device_train_batch_size,
        per_device_eval_batch_size=args.per_device_eval_batch_size,
        evaluation_strategy="epoch",
        save_strategy="epoch",
        learning_rate=args.learning_rate,
        weight_decay=0.01,
        logging_dir=os.path.join(args.output_dir, "logs"),
        logging_strategy="epoch",
        load_best_model_at_end=False,
        save_total_limit=5,
        seed=args.seed,
        push_to_hub=False,
    )

    # Metrics
    def compute_metrics(p: EvalPrediction):
        preds = p.predictions
        if isinstance(preds, tuple):
            preds = preds[0]
        preds = np.argmax(preds, axis=1)
        labels = p.label_ids
        acc = (preds == labels).mean()
        # compute f1/precision/recall using sklearn if available
        try:
            from sklearn.metrics import f1_score, precision_score, recall_score
            f1 = f1_score(labels, preds, average="weighted")
            prec = precision_score(labels, preds, average="weighted")
            rec = recall_score(labels, preds, average="weighted")
        except Exception:
            f1 = prec = rec = 0.0
        return {"accuracy": float(acc), "f1": float(f1), "precision": float(prec), "recall": float(rec)}

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=dataset["train"],
        eval_dataset=dataset["validation"],
        compute_metrics=compute_metrics,
        tokenizer=tokenizer,
        callbacks=[EpochPredictionLogger()],
    )

    # Train
    trainer.train()

    # Save model & tokenizer to output_dir
    trainer.save_model(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)

    print(f"Training completed. Model and tokenizer saved to {args.output_dir}")


if __name__ == "__main__":
    main()
