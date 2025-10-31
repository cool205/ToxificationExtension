import pandas as pd
from tabulate import tabulate


value = 'final_val_acc'
# Load CSV
df = pd.read_csv('ClassificationModel/grid_search_results.csv')

sorted_df = df.sort_values(by=value, ascending=True)

# Select columns to display
columns_to_show = ['run_idx', 'batch_size', 'learning_rate', 'max_length', 'dropout', 'final_val_acc']

# Format and print as a table
print(tabulate(sorted_df[columns_to_show], headers='keys', tablefmt='fancy_grid', showindex=False))