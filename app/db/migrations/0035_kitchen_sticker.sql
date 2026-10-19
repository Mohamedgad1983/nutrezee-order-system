-- 0035_kitchen_sticker.sql
-- WP-LBL-A97 — the kitchen's own WhatsApp-subscriber stickers, edited by the drivers' manager on the
-- Fleet-Ops "Kitchen Stickers" page instead of a Publisher file (A95). The WhatsApp sync reads the
-- active rows and prints them on Batch Labels (WhatsApp tab → Kitchen stickers) with the area's driver.

CREATE TABLE kitchen_sticker (
  id               text PRIMARY KEY,
  mobile           text NOT NULL CHECK (mobile ~ '^[0-9]{8}$'),
  name             text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 80),
  box              text CHECK (box IS NULL OR box ~ '^[0-9A-Za-z-]{1,20}$'),
  area             text NOT NULL CHECK (btrim(area) <> '' AND char_length(area) <= 80),
  block            text CHECK (block IS NULL OR char_length(block) <= 20),
  street           text CHECK (street IS NULL OR char_length(street) <= 60),
  house            text CHECK (house IS NULL OR char_length(house) <= 30),
  address_details  text CHECK (address_details IS NULL OR char_length(address_details) <= 200),
  meals_per_day    integer CHECK (meals_per_day IS NULL OR meals_per_day BETWEEN 0 AND 10),
  snacks_per_day   integer CHECK (snacks_per_day IS NULL OR snacks_per_day BETWEEN 0 AND 10),
  breakfast        integer CHECK (breakfast IS NULL OR breakfast BETWEEN 0 AND 5),
  protein_g        integer CHECK (protein_g IS NULL OR protein_g BETWEEN 0 AND 1000),
  carb_g           integer CHECK (carb_g IS NULL OR carb_g BETWEEN 0 AND 1000),
  notes            text CHECK (notes IS NULL OR char_length(notes) <= 900),
  start_date       date NOT NULL,
  end_date         date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL,
  archived_at      timestamptz,
  archived_by      text,
  CHECK ((archived_at IS NULL) = (archived_by IS NULL)),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

-- One live sticker per customer phone; stopped ones stay as history.
CREATE UNIQUE INDEX kitchen_sticker_active_mobile_idx ON kitchen_sticker (mobile) WHERE archived_at IS NULL;

COMMENT ON TABLE kitchen_sticker IS
  'A97 kitchen stickers for WhatsApp subscribers (diet notes, grams, box). Printed every delivery day from start_date while not archived; end_date only sets days remaining. Written only by m25-label.';
