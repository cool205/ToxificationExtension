import os
import csv
import math
import time
import traceback
import torch
import pandas as pd
import numpy as np
from torch.utils.data import Dataset, DataLoader
from transformers import AutoTokenizer, AutoConfig, AutoModelForSequenceClassification
from torch.optim import AdamW
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
from tqdm import tqdm
import torch.nn as nn

# === CONFIG ===
DATA_FILE = "classificationAI/classifyData.csv"
MODEL_NAME = "distilbert-base-uncased"
NUM_EPOCHS = 5

# fixed hyperparameter defaults (no CLI overrides)
DEFAULT_BATCH_SIZE = 128
DEFAULT_LR = 0.0001
DEFAULT_MAX_LENGTH = 256
DEFAULT_DROPOUT = 0.5

# early stopping threshold (stop and save when val accuracy >= this)
ACC_STOP_THRESHOLD = 0.97

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print("Using device:", DEVICE)
OUTPUT_DIR = "./ClassificationModel"
RUNS_DIR = os.path.join(OUTPUT_DIR, "runs")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(RUNS_DIR, exist_ok=True)

# results csv
RESULTS_CSV = os.path.join(OUTPUT_DIR, "grid_search_results.csv")

# Note: data is loaded inside train_one so this script uses the DATA_FILE constant

# === DATASET CLASS ===
class TextDataset(Dataset):
    def __init__(self, texts, labels, tokenizer, max_length=256):
        # tokenizer returns lists; we'll keep them until __getitem__
        self.encodings = tokenizer(texts, truncation=True, padding="max_length", max_length=max_length)
        self.labels = labels
        self.keys = list(self.encodings.keys())

    def __getitem__(self, idx):
        item = {key: torch.tensor(self.encodings[key][idx]) for key in self.keys}
        item["labels"] = torch.tensor(self.labels[idx])
        return item

    def __len__(self):
        return len(self.labels)


def evaluate_loader(model, data_loader, device):
    model.eval()
    loss_fn = nn.CrossEntropyLoss()
    losses = []
    preds_all = []
    labels_all = []
    with torch.no_grad():
        for batch in data_loader:
            batch = {k: v.to(device) for k, v in batch.items()}
            outputs = model(input_ids=batch["input_ids"], attention_mask=batch.get("attention_mask"), labels=batch["labels"]) if hasattr(model, 'config') else model(**batch)
            logits = outputs.logits
            loss = loss_fn(logits, batch["labels"])
            losses.append(loss.item())
            preds = torch.argmax(logits, dim=1).cpu().numpy()
            labels = batch["labels"].cpu().numpy()
            preds_all.extend(preds)
            labels_all.extend(labels)
    avg_loss = float(np.mean(losses)) if losses else float('nan')
    acc = float(accuracy_score(labels_all, preds_all)) if labels_all else float('nan')
    return avg_loss, acc


def run_grid_search():
    # Single-run training driven by CLI arguments
    pass


def train_one(batch_size: int, learning_rate: float, max_length: int, dropout: float, num_epochs: int, model_name: str, data_file: str, output_dir: str):
    run_name = f"run_bs{batch_size}_lr{learning_rate:.0e}_ml{max_length}_do{dropout}"
    run_output = os.path.join(RUNS_DIR, run_name)
    os.makedirs(run_output, exist_ok=True)
    step_log_path = os.path.join(run_output, "step_metrics.txt")

    # tokenizer
    tokenizer = AutoTokenizer.from_pretrained(model_name)

    # load and prepare data for this run (so CLI override works)
    df_run = pd.read_csv(data_file).dropna(subset=["text", "label"]).reset_index(drop=True)
    le_run = LabelEncoder()
    df_run["label"] = le_run.fit_transform(df_run["label"])

    # split data
    train_texts, val_texts, train_labels, val_labels = train_test_split(
        df_run["text"].tolist(), df_run["label"].tolist(), test_size=0.2, random_state=42, stratify=df_run["label"].tolist()
    )

    train_dataset = TextDataset(train_texts, train_labels, tokenizer, max_length=max_length)
    val_dataset = TextDataset(val_texts, val_labels, tokenizer, max_length=max_length)

    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=batch_size)

    # model config with dropout
    config = AutoConfig.from_pretrained(model_name, num_labels=len(le_run.classes_))
    if hasattr(config, 'hidden_dropout_prob'):
        config.hidden_dropout_prob = dropout
    if hasattr(config, 'attention_probs_dropout_prob'):
        config.attention_probs_dropout_prob = dropout

    model = AutoModelForSequenceClassification.from_pretrained(model_name, config=config)
    model.to(DEVICE)
    optimizer = AdamW(model.parameters(), lr=learning_rate)

    # training with logging (write raw txt log and structured per-step CSV)
    step_csv_path = os.path.join(run_output, "step_summary.csv")
    with open(step_log_path, "w", encoding="utf-8") as log_file, open(step_csv_path, "w", newline='', encoding="utf-8") as csvf:
        csv_writer = csv.writer(csvf)
        # header: step, epoch, loss, train_acc, val_acc, timestamp
        csv_writer.writerow(["step", "epoch", "loss", "train_acc", "val_acc", "timestamp"])

        step = 0
        model.train()
        early_stop = False
        for epoch in range(num_epochs):
            print(f"Epoch {epoch + 1}/{num_epochs}")
            for batch in train_loader:
                batch = {k: v.to(DEVICE) for k, v in batch.items()}
                outputs = model(**batch)
                loss = outputs.loss
                logits = outputs.logits
                loss.backward()
                optimizer.step()
                optimizer.zero_grad()

                preds = torch.argmax(logits, dim=1).cpu().numpy()
                labels = batch["labels"].cpu().numpy()
                train_acc = accuracy_score(labels, preds)

                # validation per-step (same as before)
                model.eval()
                val_preds, val_labels_epoch = [], []
                with torch.no_grad():
                    for val_batch in val_loader:
                        val_batch = {k: v.to(DEVICE) for k, v in val_batch.items()}
                        val_outputs = model(**val_batch)
                        val_logits = val_outputs.logits
                        val_preds.extend(torch.argmax(val_logits, dim=1).cpu().numpy())
                        val_labels_epoch.extend(val_batch["labels"].cpu().numpy())
                val_acc = accuracy_score(val_labels_epoch, val_preds) if val_labels_epoch else float('nan')
                model.train()

                log_line = f"step={step}\tepoch={epoch}\tloss={loss.item():.4f}\ttrain_acc={train_acc:.4f}\tval_acc={val_acc:.4f}"
                log_file.write(log_line + "\n")
                csv_writer.writerow([step, epoch, float(loss.item()), float(train_acc), float(val_acc), time.time()])
                print(log_line)
                step += 1

                # Early stopping: if validation accuracy meets threshold, compute final metrics, save and exit
                if not math.isnan(val_acc) and val_acc >= ACC_STOP_THRESHOLD:
                    print(f"Reached target val_acc={val_acc:.4f} >= {ACC_STOP_THRESHOLD}; saving model and stopping training.")
                    # compute final metrics on full sets
                    final_train_loss, final_train_acc = evaluate_loader(model, DataLoader(train_dataset, batch_size=batch_size), DEVICE)
                    final_val_loss, final_val_acc = evaluate_loader(model, DataLoader(val_dataset, batch_size=batch_size), DEVICE)

                    # save model and tokenizer
                    os.makedirs(output_dir, exist_ok=True)
                    model.save_pretrained(output_dir)
                    tokenizer.save_pretrained(output_dir)

                    # write a small summary csv for this run
                    summary_csv = os.path.join(OUTPUT_DIR, "run_summary.csv")
                    header = [
                        "batch_size", "learning_rate", "max_length", "dropout", "num_epochs",
                        "final_train_loss", "final_train_acc", "final_val_loss", "final_val_acc", "model_dir"
                    ]
                    write_header = not os.path.exists(summary_csv)
                    with open(summary_csv, "a", newline='', encoding='utf-8') as f:
                        writer = csv.writer(f)
                        if write_header:
                            writer.writerow(header)
                        writer.writerow([
                            batch_size, learning_rate, max_length, dropout, num_epochs,
                            final_train_loss, final_train_acc, final_val_loss, final_val_acc, output_dir
                        ])

                    early_stop = True
                    break
            if early_stop:
                break

    # if training completed without early stop, do final evaluation and save
    if not early_stop:
        final_train_loss, final_train_acc = evaluate_loader(model, DataLoader(train_dataset, batch_size=batch_size), DEVICE)
        final_val_loss, final_val_acc = evaluate_loader(model, DataLoader(val_dataset, batch_size=batch_size), DEVICE)

        # save model and tokenizer
        os.makedirs(output_dir, exist_ok=True)
        model.save_pretrained(output_dir)
        tokenizer.save_pretrained(output_dir)

        # write a small summary csv for this run
        summary_csv = os.path.join(OUTPUT_DIR, "run_summary.csv")
        header = [
            "batch_size", "learning_rate", "max_length", "dropout", "num_epochs",
            "final_train_loss", "final_train_acc", "final_val_loss", "final_val_acc", "model_dir"
        ]
        write_header = not os.path.exists(summary_csv)
        with open(summary_csv, "a", newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            if write_header:
                writer.writerow(header)
            writer.writerow([
                batch_size, learning_rate, max_length, dropout, num_epochs,
                final_train_loss, final_train_acc, final_val_loss, final_val_acc, output_dir
            ])

        print(f"Training finished. Model saved to {output_dir}")
        print(f"Final val_acc={final_val_acc:.4f} val_loss={final_val_loss:.4f}")

    


if __name__ == "__main__":
    # Run a single training job with fixed hyperparameters (no CLI overrides)
    final_output = os.path.join(OUTPUT_DIR, "final_model")
    train_one(
        batch_size=DEFAULT_BATCH_SIZE,
        learning_rate=DEFAULT_LR,
        max_length=DEFAULT_MAX_LENGTH,
        dropout=DEFAULT_DROPOUT,
        num_epochs=NUM_EPOCHS,
        model_name=MODEL_NAME,
        data_file=DATA_FILE,
        output_dir=final_output,
    )