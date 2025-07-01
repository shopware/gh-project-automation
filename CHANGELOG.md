# Changelog

## [1.7.2](https://github.com/shopware/gh-project-automation/compare/v1.7.1...v1.7.2) (2025-07-01)


### Bug Fixes

* abort processing stale PR, when no verified domain email was found for the assignee ([#36](https://github.com/shopware/gh-project-automation/issues/36)) ([0f834fc](https://github.com/shopware/gh-project-automation/commit/0f834fc99d764fcf9e3cf1f02a0a65944403c001))
* skip messaging via Slack, comment upon closing instead ([#37](https://github.com/shopware/gh-project-automation/issues/37)) ([0f834fc](https://github.com/shopware/gh-project-automation/commit/0f834fc99d764fcf9e3cf1f02a0a65944403c001))

## [1.7.1](https://github.com/shopware/gh-project-automation/compare/v1.7.0...v1.7.1) (2025-06-25)


### Bug Fixes

* add dry-run mode ([#34](https://github.com/shopware/gh-project-automation/issues/34)) ([6c516e1](https://github.com/shopware/gh-project-automation/commit/6c516e1fe5f4b8fc09b6b26998d0202bfdc0f812))

## [1.7.0](https://github.com/shopware/gh-project-automation/compare/v1.6.2...v1.7.0) (2025-06-24)


### Features

* pull request reminders support ([#31](https://github.com/shopware/gh-project-automation/issues/31)) ([1b186e8](https://github.com/shopware/gh-project-automation/commit/1b186e86881de70ebed6d806aba60f60a260fdcf))

## [1.6.2](https://github.com/shopware/gh-project-automation/compare/v1.6.1...v1.6.2) (2025-06-04)


### Bug Fixes

* getProjectInfo variable ([#27](https://github.com/shopware/gh-project-automation/issues/27)) ([45d5b7b](https://github.com/shopware/gh-project-automation/commit/45d5b7be462fdf9715e9911c41ca29e581f1c21b))

## [1.6.1](https://github.com/shopware/gh-project-automation/compare/v1.6.0...v1.6.1) (2025-05-28)


### Bug Fixes

* return repository information when searching for related issues ([#25](https://github.com/shopware/gh-project-automation/issues/25)) ([2d2fe3e](https://github.com/shopware/gh-project-automation/commit/2d2fe3e19425e008bbad21804d8d9523fe6af60b))

## [1.6.0](https://github.com/shopware/gh-project-automation/compare/v1.5.0...v1.6.0) (2025-05-27)


### Features

* add method to fetch related issues by PR ([#23](https://github.com/shopware/gh-project-automation/issues/23)) ([c8b6eab](https://github.com/shopware/gh-project-automation/commit/c8b6eabe1bb8965047ac2700c64f554e58a41178))

## [1.5.0](https://github.com/shopware/gh-project-automation/compare/v1.4.2...v1.5.0) (2025-05-23)


### Features

* add doc tasks for all epics in progress, that don't already reference one ([#21](https://github.com/shopware/gh-project-automation/issues/21)) ([eb5a9a0](https://github.com/shopware/gh-project-automation/commit/eb5a9a0ba4158a4730e1b0d5433a3e17f9ccfbaa))

## [1.4.2](https://github.com/shopware/gh-project-automation/compare/v1.4.1...v1.4.2) (2025-05-20)


### Bug Fixes

* remove issue title from logs ([#19](https://github.com/shopware/gh-project-automation/issues/19)) ([8793bcf](https://github.com/shopware/gh-project-automation/commit/8793bcfd76f5733e9b50ca8c49774aa2c876a9ce))

## [1.4.1](https://github.com/shopware/gh-project-automation/compare/v1.4.0...v1.4.1) (2025-05-16)


### Bug Fixes

* add missing $ to labelableId ([#17](https://github.com/shopware/gh-project-automation/issues/17)) ([05bd8ec](https://github.com/shopware/gh-project-automation/commit/05bd8ecb6a2015b92f70e6e019c91dd9b3d0fe31))

## [1.4.0](https://github.com/shopware/gh-project-automation/compare/v1.3.1...v1.4.0) (2025-05-16)


### Features

* add cleanupNeedsTriage ([#15](https://github.com/shopware/gh-project-automation/issues/15)) ([c8d0f96](https://github.com/shopware/gh-project-automation/commit/c8d0f963e8f50144046983a1db334992d90b027b))


### Bug Fixes

* markStaleIssues logic ([#11](https://github.com/shopware/gh-project-automation/issues/11)) ([77d2eeb](https://github.com/shopware/gh-project-automation/commit/77d2eeb39f1027422acb871a8a09a312c12b98e6))

## [1.3.1](https://github.com/shopware/gh-project-automation/compare/v1.3.0...v1.3.1) (2025-05-14)


### Bug Fixes

* allow documentation project ID to be passed in ([#13](https://github.com/shopware/gh-project-automation/issues/13)) ([086a6f6](https://github.com/shopware/gh-project-automation/commit/086a6f6a80a7b2566fad4e281157a727ce239479))

## [1.3.0](https://github.com/shopware/gh-project-automation/compare/v1.2.0...v1.3.0) (2025-05-14)


### Features

* add logic for automatic documentation task creation ([#12](https://github.com/shopware/gh-project-automation/issues/12)) ([e2aae79](https://github.com/shopware/gh-project-automation/commit/e2aae79bd0d5ef597b5f5218905f1a632846d4ce))


### Bug Fixes

* convert param to number in markStaleIssues ([#9](https://github.com/shopware/gh-project-automation/issues/9)) ([eb100cf](https://github.com/shopware/gh-project-automation/commit/eb100cfc1f72d0064183348379b77e756d8e962e))

## [1.2.0](https://github.com/shopware/gh-project-automation/compare/v1.1.1...v1.2.0) (2025-04-07)


### Features

* add sync issue priority and mark and close stale issues ([#7](https://github.com/shopware/gh-project-automation/issues/7)) ([084ed2a](https://github.com/shopware/gh-project-automation/commit/084ed2ad97d83bcb61e1f2973ca50b45541234ac))

## [1.1.1](https://github.com/shopware/gh-project-automation/compare/v1.1.0...v1.1.1) (2025-03-14)


### Bug Fixes

* return project items correctly and fix type ([9bc36ac](https://github.com/shopware/gh-project-automation/commit/9bc36ac8f551aa7e109aae6e73e0cea68c2512f4))

## [1.1.0](https://github.com/shopware/gh-project-automation/compare/v1.0.1...v1.1.0) (2025-03-14)


### Features

* use optionalDependencies ([c5e906d](https://github.com/shopware/gh-project-automation/commit/c5e906d66bb75ddc1a0401e68a0496871dabb964))

## [1.0.1](https://github.com/shopware/gh-project-automation/compare/v1.0.0...v1.0.1) (2025-03-14)


### Bug Fixes

* fix docs ([0b92fc0](https://github.com/shopware/gh-project-automation/commit/0b92fc0af9f9c7cc0f4aa235ed9833d312ef6ec7))

## 1.0.0 (2025-03-14)


### Features

* add `setStatusInProjects` function ([83de239](https://github.com/shopware/gh-project-automation/commit/83de2393fa48aae922f04349ded198804235f12b))
