# DPO Detoxifier - Quick Start Guide

## Setup (First Time)

### 1. Install Dependencies
```powershell
cd c:\Users\Wilso\OneDrive\Desktop\ToxificationExtension\DetoxifierAI
pip install -r requirements.txt
```

### 2. Initial Model Training
```powershell
cd DetoxifierAI
python init_train.py
```
**Time**: ~3-4 hours on GPU  
**Output**: `reinforcementTraining/t5-small-detox-finetuned/`

## Running the DPO Loop

### 3. Start Flask App
```powershell
cd reinforcementTraining
python app.py
```
**Output**: `Running on http://localhost:5000`

### 4. User Interaction (in browser)
- Go to `http://localhost:5000`
- Enter toxic text
- Click "Generate Options"
- Choose the best option (green highlight)
- Click "✓ Submit Choice"
- Preference saved! ✓

### 5. Collect 10-20 Preferences
Repeat step 4 multiple times to build preference dataset

### 6. Retrain with DPO
Option A: Click "🔄 Retrain Model (DPO)" button in app
Option B: Manual retrain
```powershell
cd DetoxifierAI
python after_train.py
```
**Time**: ~20-30 mins on GPU  
**Result**: Model improved with user feedback

### 7. Repeat
- Go back to step 3
- Get more user preferences
- Retrain again when you have ~10 more

## File Locations

| File | Location |
|------|----------|
| Initial training | `DetoxifierAI/init_train.py` |
| Flask app | `DetoxifierAI/reinforcementTraining/app.py` |
| DPO training | `DetoxifierAI/after_train.py` |
| Model checkpoint | `DetoxifierAI/reinforcementTraining/t5-small-detox-finetuned/` |
| Preferences data | `DetoxifierAI/reinforcementTraining/user_preferences.json` |
| UI template | `DetoxifierAI/reinforcementTraining/templates/index.html` |

## Expected Output

### After init_train.py
```
Using GPU: True
Script directory: ...
Loaded 19743 training pairs
Map: 100%|██████████| 19743/19743
Starting training with 18755 training samples and 988 eval samples...
...
Training complete. Model saved to ...
```

### After Flask app startup
```
* Running on http://127.0.0.1:5000
* Debug mode: off
```

### After /choose endpoint (preference saved)
```json
{
  "success": true,
  "message": "Preference saved! Total preferences: 5",
  "chosen": "You could improve in this area",
  "rejected_count": 2
}
```

### After /retrain endpoint (DPO training)
```json
{
  "success": true,
  "message": "Retraining complete! Trained on 12 preference pairs.",
  "output": "DPO fine-tuning complete. Model saved to ..."
}
```

## Common Issues

### "Module 'trl' not found"
```powershell
pip install trl>=0.7.0
```

### Flask app can't find model
- Make sure `init_train.py` completed successfully
- Check: `reinforcementTraining/t5-small-detox-finetuned/` exists

### CUDA out of memory during DPO
Edit `after_train.py` line ~95:
```python
per_device_train_batch_size=2,  # or 1
```

### No preferences to train on
- Go to http://localhost:5000
- Submit at least 1 preference before clicking retrain

## Next Steps

After collecting enough preferences and retraining:
- **Monitor quality**: Check if outputs improved
- **Diversify**: Try different types of toxic language
- **Iterate**: Repeat preference collection → DPO training cycle
- **Evaluate**: Save best model version by copying checkpoint

## Architecture Summary

```
1. init_train.py (Supervised)
   └─> t5-small-detox-finetuned/ (Base model)
       └─> User interaction via Flask
           └─> Preferences collected
               └─> after_train.py (DPO)
                   └─> Model improved!
                       └─> Back to Flask (cycle repeats)
```

## Key Concepts

- **DPO**: Direct Preference Optimization - learns from user choices
- **Chosen**: Best detoxification option
- **Rejected**: Worse detoxification options
- **Beta**: Controls preference strength (0.1 = strong preference signal)
- **Preference data**: JSON list of {toxic, chosen, rejected}

---

**Need help?** Check `README_DPO.md` for detailed docs
