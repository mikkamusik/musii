import time

from mikka_agent.security import DeviceStore, PairingManager, RateLimiter, TicketStore


def test_pairing_single_use(tmp_path):
    pm = PairingManager(tmp_path)
    code = pm.create_code()
    assert len(code) == 6 and pm.has_active_code()
    assert pm.consume(code)
    assert not pm.consume(code)


def test_pairing_lockout(tmp_path):
    pm = PairingManager(tmp_path)
    code = pm.create_code()
    wrong = "%06d" % ((int(code) + 1) % 1000000)
    for _ in range(5):
        assert not pm.consume(wrong)
    assert not pm.consume(code)  # nach 5 Fehlversuchen ungueltig


def test_device_tokens_hashed_and_revocable(tmp_path):
    store = DeviceStore(tmp_path)
    dev = store.register("Pixel")
    assert dev["token"] not in (tmp_path / "devices.json").read_text()
    assert store.verify(dev["token"])["name"] == "Pixel"
    assert store.verify("x" * 43) is None
    # Widerruf ueber eine zweite Instanz (CLI) wird erkannt
    time.sleep(0.01)
    assert DeviceStore(tmp_path).revoke(dev["device_id"])
    assert store.verify(dev["token"]) is None
    assert not store.is_active(dev["device_id"])


def test_device_inactivity(tmp_path):
    store = DeviceStore(tmp_path, inactivity_days=1)
    dev = store.register("Alt")
    store._devices[0]["last_seen"] = time.time() - 3 * 86400
    assert store.verify(dev["token"]) is None


def test_tickets_single_use():
    ts = TicketStore()
    t = ts.issue("d1", "audio", {"quality": "low"})
    assert ts.consume(t, "download") is None  # falscher Zweck verbraucht es
    t = ts.issue("d1", "audio", {"quality": "low"})
    assert ts.consume(t, "audio")["payload"] == {"quality": "low"}
    assert ts.consume(t, "audio") is None
    t = ts.issue("d1", "audio", ttl=-1)
    assert ts.consume(t, "audio") is None


def test_rate_limiter():
    rl = RateLimiter(2, 60)
    assert rl.allow("a") and rl.allow("a") and not rl.allow("a")
    assert rl.allow("b")
