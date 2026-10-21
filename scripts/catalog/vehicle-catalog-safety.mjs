export const VEHICLE_APPLICATION_YEAR_CAPS = [
  {
    applicationId: "ap_c7c7e5588c7ca43555c0",
    yearTo: 2018,
    reason: "Honda CR-V RM3/K24Z9 is not a 2020+ application"
  }
];

export function applyVehicleCatalogSafety(data) {
  const corrections = [];
  const capByApplication = new Map(
    VEHICLE_APPLICATION_YEAR_CAPS.map((policy) => [policy.applicationId, policy])
  );

  data.applications = data.applications.map((row) => {
    const policy = capByApplication.get(row.application_id);
    if (!policy || Number(row.year_to) <= policy.yearTo) return row;
    corrections.push({
      application_id: row.application_id,
      previous_year_to: Number(row.year_to),
      year_to: policy.yearTo,
      reason: policy.reason
    });
    return { ...row, year_to: policy.yearTo, review_status: "approved" };
  });

  data.applicationYears = data.applicationYears.filter((row) => {
    const policy = capByApplication.get(row.application_id);
    return !policy || Number(row.model_year) <= policy.yearTo;
  });

  return corrections;
}
