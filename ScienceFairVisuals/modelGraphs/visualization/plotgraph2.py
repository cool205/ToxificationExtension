import matplotlib.pyplot as plt
import re

# Initialize lists to store steps and losses
steps = []
losses = []

# Read and parse the file
with open('metrics_log.txt', 'r') as file:
    for line in file:
        match = re.search(r"Step (\d+) - Loss: ([0-9.]+)", line)
        if match:
            step = int(match.group(1))
            loss = float(match.group(2))
            steps.append(step)
            losses.append(loss)

# Plot the data

plt.figure(figsize=(8, 5))
plt.plot(steps, losses, marker='o', linestyle='-', color='blue', label='Loss')
plt.yscale('log')  # Apply logarithmic scale to y-axis
plt.xlabel('Training Step')
plt.ylabel('Loss (log scale)')
plt.title('Training Loss Over Steps')
plt.grid(True)
plt.legend()
plt.tight_layout()
plt.show()