import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
import argparse
from matplotlib import cm
from matplotlib.colors import TwoSlopeNorm
import matplotlib.ticker as ticker


# ─── Argument Parser ────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description='Visualize grid search results')
parser.add_argument('--mode', choices=['Full', '2X4'], default='Full', help='Visualization mode')
args = parser.parse_args()

# ─── Load and Preprocess CSV ────────────────────────────────────────────────────
df = pd.read_csv('ClassificationModel/grid_search_results.csv')
df['learning_rate'] = df['learning_rate'].astype(float)

# Normalize color with TwoSlopeNorm for better contrast
norm = TwoSlopeNorm(vmin=0.54, vcenter=0.90, vmax=0.97)
colors = cm.viridis(norm(df['final_val_acc']))
sizes = 80

# ─── Full Mode: Two 3D Scatter Plots ────────────────────────────────────────────
if args.mode == 'Full':
    from mpl_toolkits.mplot3d import Axes3D

    # Map hyperparameters to evenly spaced indices
    lr_levels = sorted(df['learning_rate'].unique())
    dropout_levels = sorted(df['dropout'].unique())
    batch_levels = sorted(df['batch_size'].unique())

    df['lr_idx'] = df['learning_rate'].map({v: i for i, v in enumerate(lr_levels)})
    df['dropout_idx'] = df['dropout'].map({v: i for i, v in enumerate(dropout_levels)})
    df['batch_idx'] = df['batch_size'].map({v: i for i, v in enumerate(batch_levels)})

    df_256 = df[df['max_length'] == 256]
    df_512 = df[df['max_length'] == 512]

    fig = plt.figure(figsize=(16, 7))

    for i, (subset, title) in enumerate([(df_256, 'Max Length = 256'), (df_512, 'Max Length = 512')]):
        ax = fig.add_subplot(1, 2, i + 1, projection='3d')
        ax.scatter(
            subset['lr_idx'],
            subset['dropout_idx'],
            subset['batch_idx'],
            c=cm.viridis(norm(subset['final_val_acc'])),
            s=80,
            alpha=0.8,
            edgecolors='w'
        )
        ax.set_title(title)
        ax.set_xlabel('Learning Rate')
        ax.set_ylabel('Dropout')
        ax.set_zlabel('Batch Size')
        ax.set_xticks(range(len(lr_levels)))
        ax.set_xticklabels([f'{v:.0e}' for v in lr_levels])
        ax.set_yticks(range(len(dropout_levels)))
        ax.set_yticklabels([str(v) for v in dropout_levels])
        ax.set_zticks(range(len(batch_levels)))
        ax.set_zticklabels([str(v) for v in batch_levels])

    mappable = cm.ScalarMappable(cmap=cm.viridis, norm=norm)
    mappable.set_array(df['final_val_acc'])
    cbar = fig.colorbar(mappable, ax=fig.axes, shrink=0.6, aspect=20)
    cbar.set_label('Final Validation Accuracy')

    plt.tight_layout()
    plt.show()

# ─── 2X4 Mode: Grid of 2×4 Subplots ─────────────────────────────────────────────
elif args.mode == '2X4':
    import matplotlib.ticker as ticker
    from matplotlib.colors import TwoSlopeNorm
    from matplotlib.cm import ScalarMappable

    lr_values = sorted(df['learning_rate'].unique())
    max_lengths = sorted(df['max_length'].unique())
    dropout_levels = sorted(df['dropout'].unique())
    batch_levels = sorted(df['batch_size'].unique())

    # Fixed normalization range with margin
    acc_min = 0.50
    acc_max = 1.00
    margin = 0.01 * (acc_max - acc_min)
    norm = TwoSlopeNorm(vmin=acc_min - margin, vcenter=0.90, vmax=acc_max + margin)

    fig, axes = plt.subplots(2, 4, figsize=(16, 8), sharex=False, sharey=False)

    for i, max_len in enumerate(max_lengths):
        for j, lr in enumerate(lr_values):
            ax = axes[i, j]
            subset = df[(df['max_length'] == max_len) & (df['learning_rate'] == lr)]

            # Build accuracy matrix
            heatmap = np.full((len(batch_levels), len(dropout_levels)), np.nan)
            label_map = {}

            for idx, row in subset.iterrows():
                x = dropout_levels.index(row['dropout'])
                y = batch_levels.index(row['batch_size'])
                heatmap[y, x] = row['final_val_acc']
                label_map[(x, y)] = f"#{idx}\n{row['final_val_acc']:.4f}"

            # Plot heatmap
            im = ax.imshow(
                heatmap,
                cmap='viridis',
                norm=norm,
                aspect='auto',
                origin='lower',
                extent=[0, len(dropout_levels), 0, len(batch_levels)]
            )

            # Add text labels inside each cell
            for (x, y), label in label_map.items():
                ax.text(
                    x + 0.5,
                    y + 0.5,
                    label,
                    ha='center',
                    va='center',
                    fontsize=8,
                    color='white' if heatmap[y, x] < 0.85 else 'black'
                )

            ax.set_title(f'ML={max_len}, LR={lr:.0e}', fontsize=10)
            ax.set_xticks(np.arange(len(dropout_levels)) + 0.5)
            ax.set_xticklabels([str(v) for v in dropout_levels], rotation=45)
            ax.set_yticks(np.arange(len(batch_levels)) + 0.5)
            ax.set_yticklabels([str(v) for v in batch_levels])
            ax.set_xlabel('Dropout')
            ax.set_ylabel('Batch Size')

    # External colorbar with percentage ticks
    sm = ScalarMappable(cmap='viridis', norm=norm)
    sm.set_array([])

    cbar_ax = fig.add_axes([0.92, 0.15, 0.015, 0.7])
    cbar = fig.colorbar(sm, cax=cbar_ax)
    tick_values = np.linspace(0.50, 1.00, num=6)
    cbar.set_ticks(tick_values)
    cbar.set_ticklabels([f"{int(v * 100)}%" for v in tick_values])
    cbar.set_label('Final Validation Accuracy')

    plt.tight_layout(rect=[0, 0, 0.9, 1])
    plt.show()