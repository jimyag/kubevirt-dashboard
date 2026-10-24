export const certificateRequest = (request: string) =>
  request.trim().startsWith("-----BEGIN") ? btoa(request) : request.trim()

export function certificateRequestStatus(status: Record<string, unknown>) {
  const conditions = Array.isArray(status.conditions) ? status.conditions : []
  for (const type of ["Denied", "Failed"]) {
    if (conditions.some((condition) => condition.type === type && condition.status === "True")) return type
  }
  if (status.certificate) return "Issued"
  return conditions.some((condition) => condition.type === "Approved" && condition.status === "True") ? "Approved" : "Pending"
}
