const jsonStr = '{"TimeCreated":"\\/Date(1782810791414)\\/"}';
const e = JSON.parse(jsonStr);
console.log("Parsed string:", e.TimeCreated);
const match = e.TimeCreated.match(/\\\/Date\((\d+)\)\\\//);
console.log("Match with original regex:", match);
const matchFixed = e.TimeCreated.match(/\/Date\((\d+)\)\//);
console.log("Match with fixed regex:", matchFixed);
