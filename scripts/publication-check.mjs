import { auditPublication } from './publication-audit.mjs';
try {
  const { files, sources, ...report } = await auditPublication();
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
