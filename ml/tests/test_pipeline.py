"""Unit tests for the research pipeline on small hand-constructed inputs with known answers."""
import numpy as np
import pandas as pd
import pytest

from parkflow_ml import features as F
from parkflow_ml.geo import find_neighbours, haversine_m, locate_zones, normalise_street, parse_segment
from parkflow_ml.ingest import EPOCH, clean_chunk, zone_key
from parkflow_ml.occupancy import STEP_S, bucket_range, clip_overlaps, count_grid, occupancy_from_counts
from parkflow_ml.saturation import APPROACHING, NORMAL, SATURATED, detect_events, onset_matrix, state_codes, state_name

NAN = np.nan


# ---------- ingest / timestamps / missing values ----------

def _raw(**over):
    base = {
        "DeviceId": [1], "ArrivalTime": ["01/02/2019 08:00:00 AM"], "DepartureTime": ["01/02/2019 08:30:00 AM"],
        "StreetId": [10], "StreetName": ["BOURKE STREET"], "BetweenStreet1ID": [30], "BetweenStreet1": ["RUSSELL STREET"],
        "BetweenStreet2ID": [20], "BetweenStreet2": ["EXHIBITION STREET"], "AreaName": ["X"], "VehiclePresent": [True],
    }
    base.update(over)
    return pd.DataFrame(base)


def _stats():
    return {k: 0 for k in ["raw_rows", "removed_missing_fields", "removed_unparseable_time", "removed_non_positive_duration",
                           "removed_outside_2019", "removed_invalid_vehicle_present"]}


def test_timestamps_parse_to_seconds_since_epoch():
    out = clean_chunk(_raw(), _stats())
    assert out["start"].iloc[0] == (pd.Timestamp("2019-01-02 08:00") - EPOCH).total_seconds()
    assert out["end"].iloc[0] - out["start"].iloc[0] == 1800


def test_clean_chunk_counts_every_removal_reason():
    df = pd.concat([
        _raw(),
        _raw(DeviceId=[None]),
        _raw(ArrivalTime=["not a date"]),
        _raw(DepartureTime=["01/02/2019 07:00:00 AM"]),
        _raw(ArrivalTime=["12/31/2018 11:00:00 PM"]),
        _raw(VehiclePresent=["maybe"]),
    ], ignore_index=True)
    stats = _stats()
    out = clean_chunk(df, stats)
    assert len(out) == 1
    assert stats == {"raw_rows": 6, "removed_missing_fields": 1, "removed_unparseable_time": 1,
                     "removed_non_positive_duration": 1, "removed_outside_2019": 1, "removed_invalid_vehicle_present": 1}


def test_zone_key_treats_cross_streets_as_unordered():
    a = zone_key(_raw())
    b = zone_key(_raw(BetweenStreet1ID=[20], BetweenStreet2ID=[30]))
    assert a.iloc[0] == b.iloc[0] == "10:20-30"


# ---------- occupancy calculation ----------

def test_clip_overlaps_truncates_to_next_start():
    df = pd.DataFrame({"device": [1, 1, 2], "start": [0, 100, 0], "end": [200, 300, 50], "present": [True, False, True]})
    out, clipped = clip_overlaps(df)
    assert clipped == 1
    assert out["end"].tolist() == [100, 300, 50]


def test_bucket_range_is_half_open_on_grid_instants():
    first, stop = bucket_range(np.array([0, 1, 299]), np.array([300, 600, 301]))
    # [0,300) covers instant 0; [1,600) covers 300; [299,301) covers 300.
    assert first.tolist() == [0, 1, 1]
    assert stop.tolist() == [1, 2, 2]


def test_occupancy_grid_counts_and_ratio():
    # zone 0: 4 bays reporting over instants 0..3; bays 0,1 occupied throughout, bay 2 occupied from instant 2.
    s = STEP_S
    zone = np.array([0, 0, 0, 0, 0])
    start = np.array([0, 0, 0, 2 * s, 0])
    end = np.array([4 * s, 4 * s, 2 * s, 4 * s, 4 * s])
    present = np.array([True, True, False, True, False])
    first, stop = bucket_range(start, end)
    observed = count_grid(zone, first, stop, np.ones(5, bool), 1)
    occupied = count_grid(zone, first, stop, present, 1)
    assert observed[0, :5].tolist() == [4, 4, 4, 4, 0]
    assert occupied[0, :5].tolist() == [2, 2, 3, 3, 0]
    occ = occupancy_from_counts(occupied, observed, min_observed=4)
    assert occ[0, :4].tolist() == [0.5, 0.5, 0.75, 0.75]
    assert np.isnan(occ[0, 4])  # no sensors reporting -> unknown, not vacant


def test_occupancy_is_unknown_below_min_reporting_bays():
    occ = occupancy_from_counts(np.array([[1, 3]], dtype=np.int16), np.array([[2, 4]], dtype=np.int16), min_observed=4)
    assert np.isnan(occ[0, 0]) and occ[0, 1] == 0.75


# ---------- neighbours ----------

def test_segment_parsing_and_street_normalisation():
    assert normalise_street("Little Bourke Street") == "LITTLE BOURKE ST"
    street, cross = parse_segment("Russell Street between Bourke Street and Little Bourke Street")
    assert street == "RUSSELL ST" and cross == frozenset({"BOURKE ST", "LITTLE BOURKE ST"})
    assert parse_segment("no separator here") is None


def test_locate_zones_uses_mean_of_matching_bays_and_leaves_unmatched_unknown():
    zones = pd.DataFrame({"zone": [0, 1], "street": ["RUSSELL STREET", "NOWHERE ST"],
                          "between1": ["LITTLE BOURKE STREET", "A"], "between2": ["BOURKE STREET", "B"]})
    bays = pd.DataFrame({"roadsegmentdescription": ["Russell Street between Bourke Street and Little Bourke Street"] * 2,
                         "latitude": [-37.0, -37.2], "longitude": [144.0, 144.2]})
    out = locate_zones(zones, bays)
    assert out.loc[0, "latitude"] == pytest.approx(-37.1) and out.loc[0, "location_bays"] == 2
    assert np.isnan(out.loc[1, "latitude"])


def test_haversine_known_distance():
    # One degree of latitude is ~111.2 km.
    assert haversine_m(0.0, 0.0, 1.0, 0.0) == pytest.approx(111_195, rel=1e-3)


def test_neighbours_are_by_distance_not_id_and_symmetric():
    zones = pd.DataFrame({"zone": [5, 6, 7, 8], "latitude": [-37.8100, -37.8120, -37.8300, NAN], "longitude": [144.96, 144.96, 144.96, 144.96]})
    nb = find_neighbours(zones, radius_m=400)
    pairs = set(zip(nb["zone"], nb["neighbour"]))
    assert pairs == {(5, 6), (6, 5)}  # 7 is ~2.2 km away, 8 has no location
    assert nb["distance_m"].iloc[0] == pytest.approx(222.4, abs=1)


# ---------- saturation ----------

def test_state_codes_thresholds():
    s = state_codes(np.array([0.5, 0.8, 0.89, 0.9, 1.0, NAN]), threshold=0.9, margin=0.1)
    assert s.tolist() == [NORMAL, APPROACHING, APPROACHING, SATURATED, SATURATED, -1]
    assert state_name(0.95) == "SATURATED" and state_name(None) is None


def test_threshold_is_configurable():
    assert state_codes(np.array([0.86]), threshold=0.85, margin=0.1)[0] == SATURATED


def test_event_detection_requires_known_prior_below_threshold():
    occ = np.array([[0.5, 0.95, 0.97, 0.6, NAN, 0.95, 0.8, 0.92]])
    on = onset_matrix(occ, 0.9, min_below=1)
    assert np.flatnonzero(on[0]).tolist() == [1, 7]  # index 5 follows an unknown value, so it is not an onset
    ev = detect_events(occ, np.array([42]), 0.9, min_below=1)
    assert ev[["zone", "onset", "end"]].values.tolist() == [[42, 1, 3], [42, 7, -1]]
    assert ev["peak_occupancy"].iloc[0] == pytest.approx(0.97)


def test_default_event_definition_ignores_flicker_around_threshold():
    # below for 30 min (6 steps) then saturated -> event; a dip of one step and back is not a new event
    occ = np.array([[0.5] * 6 + [0.95, 0.85, 0.95] + [0.5] * 6 + [0.92]])
    assert np.flatnonzero(onset_matrix(occ, 0.9)[0]).tolist() == [6, 15]


# ---------- features / leakage ----------

def _grid():
    t = 40
    occ = np.vstack([np.linspace(0.1, 0.9, t), np.full(t, 0.5), np.linspace(0.0, 1.0, t)]).astype(np.float32)
    observed = np.full(occ.shape, 10, dtype=np.int16)
    neighbours = {0: (np.array([1, 2]), np.array([100.0, 200.0]))}
    return occ, observed, neighbours


def _times(cols):
    return pd.DatetimeIndex([pd.Timestamp("2019-03-04 00:00") + pd.Timedelta(minutes=5 * int(c)) for c in cols])


def test_temporal_features_match_hand_computation():
    occ, observed, nb = _grid()
    cols = np.array([20])
    f = F.build_features(occ, observed, np.array([0]), cols, _times(cols), nb)
    assert f["occ_t"][0] == pytest.approx(occ[0, 20])
    assert f["occ_lag3"][0] == pytest.approx(occ[0, 17])
    assert f["diff1"][0] == pytest.approx(occ[0, 20] - occ[0, 19])
    assert f["roll_mean_6"][0] == pytest.approx(occ[0, 15:21].mean())
    assert np.isnan(f["occ_lag1w"][0])  # history not available -> unknown, never filled
    assert f["dow"][0] == 0 and f["is_weekend"][0] == 0


def test_spatial_features_use_actual_neighbours():
    occ, observed, nb = _grid()
    cols = np.array([20])
    f = F.build_features(occ, observed, np.array([0]), cols, _times(cols), nb)
    assert f["nb_count"][0] == 2
    assert f["nb_mean_occ"][0] == pytest.approx((occ[1, 20] + occ[2, 20]) / 2)
    assert f["nb_max_occ"][0] == pytest.approx(max(occ[1, 20], occ[2, 20]))
    # zone without neighbours: counts are 0, aggregates unknown
    g = F.build_features(occ, observed, np.array([1]), cols, _times(cols), nb)
    assert g["nb_count"][0] == 0 and np.isnan(g["nb_mean_occ"][0])


def test_recent_onset_counts_neighbour_saturation_in_last_15_minutes():
    occ, observed, nb = _grid()
    k_onset = int(np.argmax(occ[2] >= 0.9))
    cols = np.array([k_onset, k_onset + 2, k_onset + 3])
    f = F.build_features(occ, observed, np.zeros(3, int), cols, _times(cols), nb)
    assert f["nb_n_recent_onset"].tolist() == [1, 1, 0]


def test_features_do_not_depend_on_future_values():
    occ, observed, nb = _grid()
    cols = np.array([20])
    before = F.build_features(occ, observed, np.array([0]), cols, _times(cols), nb)
    tampered = occ.copy()
    tampered[:, 21:] = 0.0  # change everything after k
    after = F.build_features(tampered, observed, np.array([0]), cols, _times(cols), nb)
    pd.testing.assert_frame_equal(before, after)


def test_targets_are_future_occupancy_and_unknown_past_grid_end():
    occ, _, _ = _grid()
    y = F.targets(occ, np.array([0, 0]), np.array([10, 39]), horizon_steps=3)
    assert y[0] == pytest.approx(occ[0, 13]) and np.isnan(y[1])
