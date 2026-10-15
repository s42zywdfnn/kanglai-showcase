export async function readDashboard() {
  const response = await fetch('data/dashboard.json', {cache:'no-store'});
  if (!response.ok) throw new Error(`数据读取失败：${response.status}`);
  return response.json();
}

export async function readProvinceGeometry() {
  const response = await fetch('assets/china-provinces.json');
  if (!response.ok) throw new Error(`地图读取失败：${response.status}`);
  return response.json();
}
