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
NUM_EPOCHS = 2
# grid search space
BATCH_SIZES = [8, 16, 32, 64, 128]
LEARNING_RATES = [1e-6, 1e-5, 1e-4, 1e-3]
MAX_LENGTHS = [256, 512]
DROPOUTS = [0.4, 0.5, 0.6]

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print("Using device:", DEVICE)
OUTPUT_DIR = "./ClassificationModel"
RUNS_DIR = os.path.join(OUTPUT_DIR, "runs")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(RUNS_DIR, exist_ok=True)

# results csv
RESULTS_CSV = os.path.join(OUTPUT_DIR, "grid_search_results.csv")

# === LOAD DATA ===
df = pd.read_csv(DATA_FILE).dropna(subset=["text", "label"]).reset_index(drop=True)
le = LabelEncoder()
df["label"] = le.fit_transform(df["label"])

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
    # prepare results CSV header
    header = [
        "run_idx", "batch_size", "learning_rate", "max_length", "dropout",
        "final_train_loss", "final_train_acc", "final_val_loss", "final_val_acc"
    ]
    if not os.path.exists(RESULTS_CSV):
        with open(RESULTS_CSV, "w", newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(header)

    combos = []
    for bs in BATCH_SIZES:
        for lr in LEARNING_RATES:
            for ml in MAX_LENGTHS:
                for do in DROPOUTS:
                    combos.append((bs, lr, ml, do))

    total = len(combos)
    print(f"Starting grid search with {total} runs")

    run_idx = 0
    for (bs, lr, ml, do) in combos:
        run_idx += 1
        run_name = f"run_bs{bs}_lr{lr:.0e}_ml{ml}_do{do}_{run_idx}"
        run_output = os.path.join(RUNS_DIR, run_name)
        os.makedirs(run_output, exist_ok=True)

        step_log_path = os.path.join(run_output, "step_metrics.txt")
        print(f"\n[{run_idx}/{total}] Starting {run_name}")

        try:
            # tokenizer per run (max_length used by dataset)
            tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)

            # split data
            train_texts, val_texts, train_labels, val_labels = train_test_split(
                df["text"].tolist(), df["label"].tolist(), test_size=0.2, random_state=42, stratify=df["label"].tolist()
            )

            train_dataset = TextDataset(train_texts, train_labels, tokenizer, max_length=ml)
            val_dataset = TextDataset(val_texts, val_labels, tokenizer, max_length=ml)

            train_loader = DataLoader(train_dataset, batch_size=bs, shuffle=True)
            val_loader = DataLoader(val_dataset, batch_size=bs)

            # model config with dropout
            config = AutoConfig.from_pretrained(MODEL_NAME, num_labels=len(le.classes_))
            # set dropout fields if present
            if hasattr(config, 'hidden_dropout_prob'):
                config.hidden_dropout_prob = do
            if hasattr(config, 'attention_probs_dropout_prob'):
                config.attention_probs_dropout_prob = do

            model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME, config=config)
            model.to(DEVICE)
            optimizer = AdamW(model.parameters(), lr=lr)

            # training loop with per-run logging
            with open(step_log_path, "w", encoding="utf-8") as log_file:
                step = 0
                model.train()
                for epoch in range(NUM_EPOCHS):
                    print(f"Epoch {epoch + 1}/{NUM_EPOCHS}")
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

                        # === VALIDATION (quick per-step sample evaluation) ===
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

                        # === LOG + PRINT ===
                        log_line = f"batchsize={bs}, learning_rate={lr}, max_length={ml}, dropout={do}, {run_idx}, step={step}\tepoch={epoch}\tloss={loss.item():.4f}\ttrain_acc={train_acc:.4f}\tval_acc={val_acc:.4f}"
                        log_file.write(log_line + "\n")
                        print(log_line)
                        step += 1

            # final evaluation on full train/val sets
            final_train_loss, final_train_acc = evaluate_loader(model, DataLoader(train_dataset, batch_size=bs), DEVICE)
            final_val_loss, final_val_acc = evaluate_loader(model, DataLoader(val_dataset, batch_size=bs), DEVICE)

        except Exception as e:
            traceback.print_exc()
            final_train_loss = final_train_acc = final_val_loss = final_val_acc = float('nan')

        # write summary to results csv
        with open(RESULTS_CSV, "a", newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow([
                run_idx, bs, lr, ml, do,
                final_train_loss, final_train_acc, final_val_loss, final_val_acc
            ])

        print(f"Finished {run_name}: val_acc={final_val_acc:.4f} val_loss={final_val_loss:.4f}")


if __name__ == "__main__":
    run_grid_search()