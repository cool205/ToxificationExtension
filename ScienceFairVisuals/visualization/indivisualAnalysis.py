import pandas as pd
import numpy as np

# Load your results
df = pd.read_csv('classificationAI/ClassificationModel/grid_search_results.csv')

# Group by dropout and compute five-number summary
def five_number_summary(x):
    return pd.Series({
        "min": np.min(x),
        "Q1": np.percentile(x, 25),
        "median": np.median(x),
        "Q3": np.percentile(x, 75),
        "max": np.max(x)
    })

summary = df.groupby("learning_rate")["final_val_acc"].apply(five_number_summary)

print("Five-number summary of validation accuracy by dropout:")
print(summary)

import pandas as pd
import seaborn as sns
import matplotlib.pyplot as plt

# Load your results (CSV should have columns: model_size, learning_rate, dropout, batch_size, val_accuracy)
df = pd.read_csv('classificationAI/ClassificationModel/grid_search_results.csv')

# Set style
sns.set(style="whitegrid")

lookingFor = "batch_size"  # Change to "batch_size" or "dropout" as needed

# Create comparative box plots
plt.figure(figsize=(8, 6))
sns.boxplot(x=lookingFor, y="final_val_acc", data=df, palette="Set2")

plt.title(f"Validation Accuracy by {lookingFor}", fontsize=14)
plt.xlabel(lookingFor, fontsize=12)
plt.ylabel("Validation Accuracy", fontsize=12)

plt.show()