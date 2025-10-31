import pandas as pd
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D
import numpy as np
from matplotlib import cm
from matplotlib.colors import Normalize

# Load CSV
df = pd.read_csv('ClassificationModel/grid_search_results.csv')
df['learning_rate'] = df['learning_rate'].astype(float)

# Map each hyperparameter to evenly spaced indices
lr_levels = sorted(df['learning_rate'].unique())
dropout_levels = sorted(df['dropout'].unique())
batch_levels = sorted(df['batch_size'].unique())

df['lr_idx'] = df['learning_rate'].map({v: i for i, v in enumerate(lr_levels)})
df['dropout_idx'] = df['dropout'].map({v: i for i, v in enumerate(dropout_levels)})
df['batch_idx'] = df['batch_size'].map({v: i for i, v in enumerate(batch_levels)})

# Normalize color for final_val_acc
norm = Normalize(vmin=df['final_val_acc'].min(), vmax=df['final_val_acc'].max())
colors = cm.viridis(norm(df['final_val_acc']))
sizes = 80

# Split by max_length
df_256 = df[df['max_length'] == 256]
df_512 = df[df['max_length'] == 512]

# Create figure
fig = plt.figure(figsize=(16, 7))

# Plot for max_length = 256
ax1 = fig.add_subplot(121, projection='3d')
sc1 = ax1.scatter(
    df_256['lr_idx'],
    df_256['dropout_idx'],
    df_256['batch_idx'],
    c=cm.viridis(norm(df_256['final_val_acc'])),
    s=80,
    alpha=0.8,
    edgecolors='w'
)
ax1.set_title('Max Length = 256')
ax1.set_xlabel('Learning Rate')
ax1.set_ylabel('Dropout')
ax1.set_zlabel('Batch Size')
ax1.set_xticks(range(len(lr_levels)))
ax1.set_xticklabels([f'{v:.0e}' for v in lr_levels])
ax1.set_yticks(range(len(dropout_levels)))
ax1.set_yticklabels([str(v) for v in dropout_levels])
ax1.set_zticks(range(len(batch_levels)))
ax1.set_zticklabels([str(v) for v in batch_levels])

# Plot for max_length = 512
ax2 = fig.add_subplot(122, projection='3d')
sc2 = ax2.scatter(
    df_512['lr_idx'],
    df_512['dropout_idx'],
    df_512['batch_idx'],
    c=cm.viridis(norm(df_512['final_val_acc'])),
    s=80,
    alpha=0.8,
    edgecolors='w'
)
ax2.set_title('Max Length = 512')
ax2.set_xlabel('Learning Rate')
ax2.set_ylabel('Dropout')
ax2.set_zlabel('Batch Size')
ax2.set_xticks(range(len(lr_levels)))
ax2.set_xticklabels([f'{v:.0e}' for v in lr_levels])
ax2.set_yticks(range(len(dropout_levels)))
ax2.set_yticklabels([str(v) for v in dropout_levels])
ax2.set_zticks(range(len(batch_levels)))
ax2.set_zticklabels([str(v) for v in batch_levels])

# Shared colorbar
mappable = cm.ScalarMappable(cmap=cm.viridis, norm=norm)
mappable.set_array(df['final_val_acc'])
cbar = fig.colorbar(mappable, ax=[ax1, ax2], shrink=0.6, aspect=20)
cbar.set_label('Final Validation Accuracy')

plt.show()