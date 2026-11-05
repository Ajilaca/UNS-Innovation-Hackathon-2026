import math

import numpy as np

from app.predictor import DosePredictor, make_features, physics_q


def feats(c0=2000, ph=9.5):
    return make_features(c0, 200, ph, 3000, 31, 500, (0.5, 0.6, 0.4))


def test_untrained_falls_back_to_physics():
    p = DosePredictor(0.0091, 0.9)
    r = p.predict(feats())
    assert r["source"] == "fisika" and r["q_lo"] < r["q"] < r["q_hi"]
    assert math.isclose(r["q"], physics_q(2000, 200, 0.9, 0.0091), rel_tol=1e-6)


def test_fit_predict_save_load(tmp_path):
    rng = np.random.default_rng(0)
    rows = []
    for _ in range(300):
        c0 = float(rng.uniform(500, 8000)); ph = float(rng.uniform(8.4, 10.8))
        f = feats(c0, ph)
        rows.append({"feat": f, "q": physics_q(c0, 200, 0.9, 0.0091) * (1.3 if ph > 9.8 else 0.9)})
    p = DosePredictor(0.0091, 0.9)
    meta = p.fit(rows)
    assert meta["mape_ml"] < meta["mape_physics"]
    lo = p.predict(feats(3000, 10.4))["q"]; hi = p.predict(feats(3000, 8.6))["q"]
    assert lo > hi                                    # learned the pH effect
    path = tmp_path / "m.joblib"
    p.save(path)
    q = DosePredictor.load(path, 0.0091, 0.9)
    assert q.trained and math.isclose(q.predict(feats())["q"], p.predict(feats())["q"])
