# Detoxifier with DPO Reinforcement Learning

This system implements **Direct Preference Optimization (DPO)** to train a T5 detoxification model using user preferences.

## Pipeline Overview

### 1. **Initial Training** (`init_train.py`)
- Trains T5-small on 19,743 toxic→neutral pairs from ParaDetox dataset
- 20 epochs with 95/5 train/val split
- GPU-accelerated with FP16 training
- Output: `t5-small-detox-finetuned/` model checkpoint

```bash
cd DetoxifierAI
python init_train.py
```

### 2. **Flask App** (`reinforcementTraining/app.py`)
- Generates **3 detoxification options** for each toxic input
- User selects the **best option**
- Saves user preferences to `user_preferences.json`
- Has `/retrain` endpoint to trigger DPO training

```bash
cd reinforcementTraining
python app.py
# Visit: http://localhost:5000
```

### 3. **DPO Retraining** (`after_train.py`)
- Loads saved user preferences (chosen vs rejected options)
- Trains model using **Direct Preference Optimization**
- Only 2 epochs (model already well-tuned from init_train)
- Very low learning rate (1e-6) for fine-tuning
- Saves improved model back to checkpoint

```bash
cd DetoxifierAI
python after_train.py
```

## Workflow

1. **Run initial training** to get a base model:
   ```bash
   python init_train.py
   ```

2. **Start the Flask app** to serve the model:
   ```bash
   cd reinforcementTraining
   python app.py
   ```

3. **User interaction loop:**
   - User enters toxic text
   - App generates 3 options
   - User clicks best option
   - Preference saved to `user_preferences.json`

4. **Collect 10-20 preferences**, then click "Retrain Model (DPO)" button
   - Or manually run: `python after_train.py`
   - Model learns from user feedback via DPO
   - Better detoxification on the next iteration

5. **Repeat** to continuously improve the model

## File Structure

```
DetoxifierAI/
├── init_train.py           # Initial supervised training
├── after_train.py          # DPO fine-tuning on user preferences
├── paradetox.tsv           # Training dataset (main)
├── paradetox_cannot_rewrite.tsv  # Training dataset (edge cases)
├── requirements.txt        # Python dependencies
└── reinforcementTraining/
    ├── app.py             # Flask app for UI & preference collection
    ├── t5-small-detox-finetuned/  # Model checkpoint
    ├── user_preferences.json       # User preference data
    ├── templates/
    │   └── index.html     # UI for preference selection
    └── static/
        └── style.css      # CSS styling
```

## User Preferences Format

`user_preferences.json`:
```json
[
  {
    "toxic": "You are dumb",
    "chosen": "You could improve in this area",
    "rejected": ["You are not smart", "You need to work harder", "Try again"]
  }
]
```

## DPO Training Details

- **Beta**: 0.1 (strength of preference loss)
- **Learning Rate**: 1e-6 (fine-tuning mode)
- **Batch Size**: 4 (per device)
- **Epochs**: 2 (model already well-trained)
- **Trainer**: `DPOTrainer` from `trl` library

## Dependencies

Install required packages:
```bash
pip install -r requirements.txt
```

Key dependencies:
- `torch`: PyTorch for GPU training
- `transformers`: Hugging Face model library
- `trl`: Training library with DPO support
- `peft`: Parameter-efficient fine-tuning
- `flask`: Web framework
- `datasets`: Dataset loading

## GPU Requirements

- Recommended: NVIDIA GPU with 8GB+ VRAM
- Min: 6GB VRAM (may need to reduce batch_size if OOM)
- CPU: ~3-4 hours per init_train, ~30 mins per DPO retrain

## Tips for Best Results

1. **Collect diverse preferences**: Cover different types of toxic language
2. **Be consistent**: Choose the same style of detoxification for similar inputs
3. **Mix up options**: Different paraphrases help the model learn better
4. **Retrain frequently**: Every 10-20 preferences to stay aligned with feedback
5. **Monitor quality**: Check model outputs after each DPO round

## Troubleshooting

**"Module 'trl' not found"**
```bash
pip install trl
```

**"CUDA out of memory"**
- Reduce `per_device_train_batch_size` to 2 or 1 in `after_train.py`
- Use `gradient_accumulation_steps` to maintain effective batch size

**"No preferences to train on"**
- Make sure you've submitted preferences in the Flask app
- Check that `user_preferences.json` exists

**Flask app won't load model**
- Run `init_train.py` first to create the model checkpoint
- Verify model path: `reinforcementTraining/t5-small-detox-finetuned/`
