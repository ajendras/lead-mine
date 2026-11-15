# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-11-15
### Added

- Add configuration file support with auto-loading in CLI and loadConfig() helper

## [0.1.0] - 2026-11-15

### Added

- Maps Scraper — Pulls name, address, phone, rating and website from Google Maps results using Playwright
- Search Leads — Extracts organic Google results and linked contact pages for broader web leads
- Yelp Support — Scrapes business listings from Yelp with fallback when Maps data is thin
- Smart Export — Writes clean CSV, JSON or XLSX with configurable columns and deduplication
- Contact Enricher — Visits websites to discover email patterns, social links and missing phones
- Polite Crawling — Built-in rate limiting, random delays, user-agent rotation and stealth to reduce blocks
- Targeted Filters — Category, location, rating, review count and keyword filters for high-quality leads
- Mockable Tests — Unit tests with recorded HTML fixtures so CI stays fast and reliable
