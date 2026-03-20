// Quick test: hit the register endpoint and show the response
const http = require("http");

const body = JSON.stringify({
  email: "devtest_" + Date.now() + "@example.com",
  password: "DevTest123!",
  password_confirm: "DevTest123!",
  display_name: "Dev Tester",
  date_of_birth: "2000-01-01",
  gender: "MALE",
});

const options = {
  hostname: "localhost",
  port: 3004,
  path: "/api/v1/auth/register",
  method: "POST",
  headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
};

const req = http.request(options, (res) => {
  let data = "";
  res.on("data", (chunk) => (data += chunk));
  res.on("end", () => {
    console.log("Status:", res.statusCode);
    try { console.log(JSON.stringify(JSON.parse(data), null, 2)); }
    catch { console.log(data); }
  });
});
req.on("error", (e) => console.error("Request failed:", e.message));
req.write(body);
req.end();
