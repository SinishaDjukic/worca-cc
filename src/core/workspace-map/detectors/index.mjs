// src/core/workspace-map/detectors/index.mjs
// The detector registry, in run order. One block per plan, alphabetical inside a block:
// P1 (this plan), then P3 (manifests / deploy / config / specs), then P4 (code).

import identity from './identity.mjs';
import pkgNpm from './pkg-npm.mjs';
// P3 — boundary detectors (manifests, deploy, config, API specs); alphabetical by id.
import apiAsyncapi from './api-asyncapi.mjs';
import apiGraphql from './api-graphql.mjs';
import apiOpenapi from './api-openapi.mjs';
import apiProto from './api-proto.mjs';
import configEnv from './config-env.mjs';
import deployCompose from './deploy-compose.mjs';
import deployK8s from './deploy-k8s.mjs';
import gitSubmodules from './git-submodules.mjs';
import pkgCargo from './pkg-cargo.mjs';
import pkgDotnet from './pkg-dotnet.mjs';
import pkgGo from './pkg-go.mjs';
import pkgGradle from './pkg-gradle.mjs';
import pkgMaven from './pkg-maven.mjs';
import pkgPython from './pkg-python.mjs';
// P4 — code detectors; alphabetical by id.
import db from './db.mjs';
import httpClients from './http-clients.mjs';
import httpRoutes from './http-routes.mjs';
import messaging from './messaging.mjs';

export const DETECTORS = Object.freeze([
  // P1
  identity,
  pkgNpm,
  // P3 — boundary detectors
  apiAsyncapi, apiGraphql, apiOpenapi, apiProto, configEnv, deployCompose, deployK8s,
  gitSubmodules, pkgCargo, pkgDotnet, pkgGo, pkgGradle, pkgMaven, pkgPython,
  // P4 — code detectors
  db, httpClients, httpRoutes, messaging,
]);

/** → the registered Detector with this id, or null */
export function detectorById(id) {
  return DETECTORS.find((d) => d.id === id) || null;
}
