"""Frozen outer comparison: scores 0..100, speed over 30 experiments."""
import json, sys
baseline, final, experiments = map(float, sys.argv[1:])
speed = max(0, 100 * (1 - experiments / 30))
improvement = min(100, max(0, (final - baseline) / max(1, experiments) * 10))
print(json.dumps({"outer_score": final * .5 + speed * .3 + improvement * .2,
                  "final_score": final, "convergence_speed": speed, "improvement_per_experiment": improvement}))
