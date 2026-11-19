export async function readAutomationResponse(response) {
  const text=await response.text();
  let data;
  try {data=JSON.parse(text);} catch {
    if(response.redirected)throw new Error('Your session has expired. Sign in to Dashboard-One again.');
    throw new Error(`Automation service returned an unexpected response (HTTP ${response.status}). Please retry.`);
  }
  if(!response.ok)throw new Error(data.error||`Automation request failed (HTTP ${response.status}).`);
  return data;
}
