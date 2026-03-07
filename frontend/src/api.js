const BASE = "/api";

async function request(url, options = {}) {
  const res = await fetch(BASE + url, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

export async function getSession() {
  return request("/session");
}

export async function uploadCSV(file, ligandName, isSecond = false) {
  const form = new FormData();
  form.append("file", file);
  form.append("ligand_name", ligandName);
  form.append("is_second", isSecond);
  return request("/upload", { method: "POST", body: form });
}

export async function uploadPDB(file) {
  const form = new FormData();
  form.append("file", file);
  return request("/upload-pdb", { method: "POST", body: form });
}

export async function getPDB() {
  return request("/pdb");
}

export async function runAggregation(isSecond = false, x1 = null, x2 = null) {
  const params = new URLSearchParams({ is_second: isSecond });
  if (x1 !== null) params.append("x1", x1);
  if (x2 !== null) params.append("x2", x2);
  return request(`/aggregate?${params}`, { method: "POST" });
}

export async function runComparison() {
  return request("/compare", { method: "POST" });
}

export async function getVizNetwork(frame = 0, ligand = 1) {
  return request(`/viz/network?frame=${frame}&ligand=${ligand}`);
}

export async function getVizCircle(residue = null, ligand = 1) {
  const params = new URLSearchParams({ ligand });
  if (residue) params.append("residue", residue);
  return request(`/viz/circle?${params}`);
}

export async function getVizHeatmap(ligand = 1) {
  return request(`/viz/heatmap?ligand=${ligand}`);
}

export async function getVizOccurrence(ligand = 1) {
  return request(`/viz/occurrence?ligand=${ligand}`);
}

export async function getVizComparison() {
  return request("/viz/comparison");
}

export async function updateParameters(params) {
  return request("/parameters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export async function generateTestData() {
  return request("/dev/generate-test-data", { method: "POST" });
}
