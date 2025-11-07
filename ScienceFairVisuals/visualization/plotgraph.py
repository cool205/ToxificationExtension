import matplotlib.pyplot as plt
import re
import os

# === CONFIG ===
LOG_FILE = "ClassificationModel/runs/bs32_lr5e-05_ml256_do0.5/step_metrics.txt"

# Initialize lists
steps, losses, train_accs, val_accs = [], [], [], []

# Check file exists
if not os.path.exists(LOG_FILE):
    raise FileNotFoundError(f"Log file not found: {LOG_FILE}")

# Read and parse the log file
with open(LOG_FILE, "r", encoding="utf-8") as file:
    for line in file:
        match = re.search(
            r"step=(\d+)\s+epoch=\d+\s+loss=([0-9.]+)\s+train_acc=([0-9.]+)\s+val_acc=([0-9.]+)",
            line,
        )
        if match:
            steps.append(int(match.group(1)))
            losses.append(float(match.group(2)))
            train_accs.append(float(match.group(3)))
            val_accs.append(float(match.group(4)))

# === Plot Loss ===
plt.figure(figsize=(10, 5))
plt.plot(steps, losses, label="Loss", color="blue", marker="o")
plt.yscale("log")  # log scale for better visibility
plt.xlabel("Training Step")
plt.ylabel("Loss (log scale)")
plt.title("Training Loss Over Steps")
plt.grid(True)
plt.legend()
plt.tight_layout()
plt.savefig("loss_curve.png")   # save to file
plt.show()

# === Plot Accuracy ===
plt.figure(figsize=(10, 5))
plt.plot(steps, train_accs, label="Train Accuracy", color="green", marker="o")
plt.plot(steps, val_accs, label="Validation Accuracy", color="orange", marker="o")
plt.xlabel("Training Step")
plt.ylabel("Accuracy")
plt.title("Accuracy Over Steps")
plt.grid(True)
plt.legend()
plt.tight_layout()
plt.savefig("accuracy_curve.png")   # save to file
plt.show()