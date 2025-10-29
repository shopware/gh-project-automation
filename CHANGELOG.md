# Changelog

## [1.12.1](https://github.com/shopware/gh-project-automation/compare/v1.12.0...v1.12.1) (2025-10-29)


### Bug Fixes

* add repository.url ([#62](https://github.com/shopware/gh-project-automation/issues/62)) ([050206f](https://github.com/shopware/gh-project-automation/commit/050206f98be67006294ca39297b304cf6ad29dc0))

## [1.12.0](https://github.com/shopware/gh-project-automation/compare/v1.11.1...v1.12.0) (2025-10-29)


### Features

* add checkMissingLicenseInRepos ([#57](https://github.com/shopware/gh-project-automation/issues/57)) ([b75be7b](https://github.com/shopware/gh-project-automation/commit/b75be7b205df96ebbfd08581f4891d982df677bd))
* add saas to branch cleanup ([#60](https://github.com/shopware/gh-project-automation/issues/60)) ([8b37ad3](https://github.com/shopware/gh-project-automation/commit/8b37ad315fedc7fc9df851c388dd0abedaed8547))

## [1.11.1](https://github.com/shopware/gh-project-automation/compare/v1.11.0...v1.11.1) (2025-08-28)


### Bug Fixes

* finding issue in setMilestoneForPR ([#55](https://github.com/shopware/gh-project-automation/issues/55)) ([fac59a5](https://github.com/shopware/gh-project-automation/commit/fac59a5c557b468665cd6a65fe4a4780e1ff9580))

## [1.11.0](https://github.com/shopware/gh-project-automation/compare/v1.10.0...v1.11.0) (2025-08-19)


### Features

* add setMilestoneForPR ([#53](https://github.com/shopware/gh-project-automation/issues/53)) ([67682e7](https://github.com/shopware/gh-project-automation/commit/67682e7128ee1145d22b2bbd0658e01af17698d6))

## [1.10.0](https://github.com/shopware/gh-project-automation/compare/v1.9.1...v1.10.0) (2025-07-31)


### Features

* add cancelStuckWorkflows ([#47](https://github.com/shopware/gh-project-automation/issues/47)) ([f19f388](https://github.com/shopware/gh-project-automation/commit/f19f388fbccaac438814cec255d2672b269aecfc))


### Bug Fixes

* catch exception when slack user was not found ([#51](https://github.com/shopware/gh-project-automation/issues/51)) ([2698d7c](https://github.com/shopware/gh-project-automation/commit/2698d7c47ef50a937619291dbb86b774a0a80ddb))
* missing permissions in cancel-stuck-workflows ([#49](https://github.com/shopware/gh-project-automation/issues/49)) ([b64413f](https://github.com/shopware/gh-project-automation/commit/b64413faf65e6a601d8895f0cdd7259f72cd6861))

## [1.9.1](https://github.com/shopware/gh-project-automation/compare/v1.9.0...v1.9.1) (2025-07-10)


### Bug Fixes

* rename close labels ([#45](https://github.com/shopware/gh-project-automation/issues/45)) ([7872e1b](https://github.com/shopware/gh-project-automation/commit/7872e1bfc83694f5472e8c7edbbd719917558de1))

## [1.9.0](https://github.com/shopware/gh-project-automation/compare/v1.8.0...v1.9.0) (2025-07-09)


### Features

* return slack user instead of the id and get user by email ([#43](https://github.com/shopware/gh-project-automation/issues/43)) ([1b679b3](https://github.com/shopware/gh-project-automation/commit/1b679b396eb76e6cf4c4a11a9810a4c5c325f772))

## [1.8.0](https://github.com/shopware/gh-project-automation/compare/v1.7.2...v1.8.0) (2025-07-02)


### Features

* cleanup old branches ([#41](https://github.com/shopware/gh-project-automation/issues/41)) ([c7eadce](https://github.com/shopware/gh-project-automation/commit/c7eadce6d31095800c8c8070ea02f17dbc76aa77))


### Bug Fixes

* explicitly specify `draft:false` in order to exclude drafts from stale check ([#42](https://github.com/shopware/gh-project-automation/issues/42)) ([22a740b](https://github.com/shopware/gh-project-automation/commit/22a740b5ce8de5208c990c0123e337c0f205fb6c))
* **syncPriorities:** set default for excludeList ([#39](https://github.com/shopware/gh-project-automation/issues/39)) ([3cdae1c](https://github.com/shopware/gh-project-automation/commit/3cdae1cdf6aeb32608d3d37e5f14d888f14b48b8))

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
