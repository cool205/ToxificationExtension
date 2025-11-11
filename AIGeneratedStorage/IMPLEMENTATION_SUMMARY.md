# DPO Implementation Summary

## What Changed

Your detoxifier now uses **Direct Preference Optimization (DPO)** reinforcement learning instead of simple ratings.

### Before: Simple Rating System
- Generate 1 option
- User rates 1-5 stars
- ❌ Doesn't teach model *which detoxification is better*

### After: DPO Preference System
- Generate **3 options** with diversity
- User selects **best option**
- All other options are "rejected"
- ✅ Model learns: "This is better than that"

## Files Modified

### 1. `reinforcementTraining/app.py`
**Changes:**
- `generate_response()` → `generate_responses()` (now 3 options)
- New function `save_preference()` saves {toxic, chosen, rejected}
- New route `/choose` handles preference submission
- New route `/retrain` runs DPO training automatically
- Uses `subprocess` to call `after_train.py`

**New endpoints:**
- `POST /` - Generate multiple options
- `POST /choose` - Save user preference
- `POST /retrain` - Trigger DPO retraining

### 2. `DetoxifierAI/after_train.py`
**Changes:**
- Now uses `DPOTrainer` from `trl` library instead of `Trainer`
- Loads `user_preferences.json` (format: {toxic, chosen, rejected})
- Trains with DPO Loss: encourages model to prefer chosen over rejected
- Very low learning rate: 1e-6 (fine-tuning mode)
- Only 2 epochs (model already well-tuned from init_train)

**Key parameters:**
- `beta=0.1` - Preference loss strength
- `learning_rate=1e-6` - Fine-tuning LR
- `num_train_epochs=2` - Quick convergence

### 3. `reinforcementTraining/templates/index.html`
**Changes:**
- Completely redesigned for preference selection
- Shows 3 option buttons
- Click button → green highlight (selected)
- "✓ Submit Choice" button
- "🔄 Retrain Model (DPO)" button in separate section
- JavaScript handling for AJAX requests
- Real-time status updates

### 4. New File: `requirements.txt`
Added dependencies:
- `trl>=0.7.0` (DPO trainer)
- `peft>=0.7.0` (Parameter-efficient fine-tuning)
- All other ML libraries

### 5. Documentation Files
- `README_DPO.md` - Comprehensive pipeline documentation
- `QUICKSTART.md` - Step-by-step getting started guide

### 6. `init_train.py` 
**No changes** - Still trains 20 epochs on full dataset

## Data Flow

```
User enters toxic text
    ↓
Flask app calls generate_responses(toxic_input, num_options=3)
    ↓
Model generates 3 diverse detoxifications (high temp=0.9)
    ↓
User sees 3 options in browser
    ↓
User clicks best option (green highlight)
    ↓
User clicks "✓ Submit Choice"
    ↓
JavaScript sends: {toxic, chosen, options} to /choose endpoint
    ↓
Flask saves to user_preferences.json: {toxic, chosen, rejected}
    ↓
Repeat 10-20 times...
    ↓
User clicks "🔄 Retrain Model (DPO)"
    ↓
Flask calls subprocess to run after_train.py
    ↓
after_train.py loads user_preferences.json
    ↓
DPOTrainer trains model (2 epochs, LR=1e-6)
    ↓
Model learns: "preferred output > rejected outputs"
    ↓
Updated model saved
    ↓
Next Flask session uses improved model
```

## User Preferences Format

**File**: `reinforcementTraining/user_preferences.json`

```json
[
  {
    "toxic": "You are dumb",
    "chosen": "You could improve in this area",
    "rejected": [
      "You are not smart",
      "You need to work harder",
      "Try again"
    ]
  },
  {
    "toxic": "I hate you",
    "chosen": "I don't appreciate this behavior",
    "rejected": [
      "This bothers me",
      "I'm upset with you",
      "That's not good"
    ]
  }
]
```

## How DPO Works

**DPO Loss Function:**
```
loss = -E[(chosen - rejected) - β * KL(policy || reference)]
```

- **Maximize**: (chosen score - rejected score)
- **Minimize**: KL divergence from original model (prevents collapse)
- **β=0.1**: Weight of KL penalty

**Result**: Model learns to:
1. Increase probability of chosen output
2. Decrease probability of rejected outputs
3. Stay close to original model (don't overfit)

## Training Timeline

| Step | Time | Action |
|------|------|--------|
| 1 | ~4 hours | Run `init_train.py` (20 epochs) |
| 2 | Ongoing | User interacts via Flask app |
| 3 | Ongoing | Preferences accumulate in JSON |
| 4 | ~30 mins | Run `after_train.py` (DPO, 2 epochs) |
| 5 | Ongoing | Model improved, back to step 2 |

## Key Improvements Over Simple Rating

| Aspect | Rating | DPO |
|--------|--------|-----|
| Signal | 1-5 star | Binary: better/worse |
| Learning | Per option | Comparative learning |
| Efficiency | Slow | Fast (needs fewer examples) |
| Alignment | Weak | Strong (direct preference) |
| Scalability | Yes | Yes (RLHF-inspired) |

## Quality Metrics

To measure improvement:
1. **Diversity**: Generate options for same input multiple times
2. **Consistency**: Check if "best" choices are logical
3. **Convergence**: Loss should decrease during DPO training
4. **User feedback**: Ask users if detoxification quality improved

## Next Steps for Production

1. **Collect more preferences** (100+) for better training signal
2. **Add evaluation metrics** (BLEU, ROUGE, semantic similarity)
3. **Implement preference quality control** (reject low-confidence users)
4. **Add model versioning** (save checkpoints, rollback if needed)
5. **Deploy to production** (model serving, A/B testing)

---

**Questions?** See README_DPO.md or QUICKSTART.md
