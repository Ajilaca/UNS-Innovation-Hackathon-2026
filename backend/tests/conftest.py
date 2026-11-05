import pytest

from app.config import load_config


@pytest.fixture
def cfg():
    return load_config("baseline")


@pytest.fixture
def sunny(cfg):
    return load_config("cerah-umkm-kecil")
