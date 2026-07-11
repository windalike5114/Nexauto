-- Apply the NexAutoParts first-stage wiper pricing model.
-- Daily public offer: NZ$59.99
-- Brand anchor / compare-at price: NZ$79.99

update wiper_sets
set
  price = 59.99,
  compare_at_price = 79.99,
  updated_at = now()
where set_type = 'front_pair';
