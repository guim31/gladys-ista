// -----------------------------------------------------------------------------
// Entry point of the ista Web'conso integration for Gladys Assistant.
//
// SDK wiring only: the handlers live in src/app.js (registered before
// connect()), the portal client in src/ista/, the reading loop in src/sync.js.
//
// The Gladys supervisor injects GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN
// and GLADYS_INTEGRATION_SELECTOR: `new GladysIntegration()` reads them.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from './src/app.js';

const gladys = new GladysIntegration();
registerHandlers(gladys);

logger.info('Starting the ista Web’conso integration...');
gladys.connect().catch((err) => {
  logger.error(`Initial connection failed: ${err.message}`);
  process.exit(1);
});
