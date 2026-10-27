-- Align sellable front-pair constraints with the front lengths already
-- accepted by the application and the cross-reviewed WiperTech catalogue.
alter table public.wiper_sets
  drop constraint if exists wiper_sets_driver_approved_check,
  drop constraint if exists wiper_sets_passenger_approved_check,
  add constraint wiper_sets_driver_approved_check
    check (driver_length_in in (12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27, 28, 30)) not valid,
  add constraint wiper_sets_passenger_approved_check
    check (passenger_length_in in (12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27, 28, 30)) not valid;
