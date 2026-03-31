-- Per-SKU points multiplier overrides
-- If a SKU isn't in this table, it uses the default rate (1x)

CREATE TABLE IF NOT EXISTS sku_points_overrides (
  sku         text PRIMARY KEY,
  description text,
  multiplier  numeric DEFAULT 1,
  updated_at  timestamptz DEFAULT now()
);

-- Seed all current SKUs at 1x
INSERT INTO sku_points_overrides (sku, description, multiplier) VALUES
  ('Balm-VR60',          'Tallow Balm - Vanilla Rose 60ml',              1),
  ('Balm-VR120',         'Tallow Balm - Vanilla Rose 120ml',             1),
  ('F250',               'Whipped Tallow Balm - Frankincense 250ml',     1),
  ('Balm-PG-VM120',      'Tallow & Honey Balm - Manuka & Vanilla 120ml', 1),
  ('trio-VVV-120',       'Tallow Balm Trio - VVV 120ml',                 1),
  ('balm-trio-VFL120',   'Tallow Balm Trio - VFL 120ml',                 1),
  ('trio-VVL-120',       'Tallow Balm Trio - VVL 120ml',                 1),
  ('shampoo',            'Tallow Shampoo Bar',                            1),
  ('shampoo-bottle',     'Tallow Shampoo - Fresh Geranium 500ml',        1),
  ('eye-c',              'Tallow Eye Cream',                              1),
  ('day-night-duo',      'Day n Night Duo',                               1),
  ('reviana-night',      'Night Cream 50ml - Reviana',                    1),
  ('reviana-complexion', 'Complexion Bundle - Reviana',                   1)
ON CONFLICT (sku) DO NOTHING;
