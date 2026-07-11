-- Update existing front-pair wiper set names for clearer SEO and customer-facing copy.
update wiper_sets
set
  name = 'Premium Front Windscreen Wiper Blade Pair - ' ||
    trim(to_char(greatest(driver_length_in, passenger_length_in), 'FM999D9'), '.') ||
    '" + ' ||
    trim(to_char(least(driver_length_in, passenger_length_in), 'FM999D9'), '.') ||
    '"',
  updated_at = now()
where set_type = 'front_pair';
