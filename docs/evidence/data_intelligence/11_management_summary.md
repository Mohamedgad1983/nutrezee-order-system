# 11 — Executive Summary (for Management)

> Plain-language summary of what our data can and cannot do for AI today. No technical jargon, no
> customer data.

## What data do we currently have?
A solid **customer and order backbone**: ~19,500 customers (7,900 of them buyers), ~20,100 orders with
their calorie-tier package, dates, prices, and delivery area, ~11,500 payment records, and a complete
**daily delivery schedule** of ~528,000 plan-days spanning 2024–2026. We also have last-90-days
meal-day dates for ~2,600 customers.

## How reliable is it?
The backbone is **reliable** (who bought what package, when, for how much, where, and how often). What is
**missing or unreliable**: the actual **dishes** customers ate, **delivery outcomes** (every day is
marked only "scheduled"), **nutrition**, **allergies/diet**, **customer feedback**, and any
**driver/kitchen/packing** operational data — those tables are essentially empty.

## What can we analyze now?
A lot of high-value business intelligence: customer segments, who is **loyal vs lapsing vs churned**
(52% of buyers reorder; ~1,600 lapsed in the last 3 months are prime win-back), **package/calorie-tier
popularity** (one tier is ~half of all orders), **revenue & payment** trends (median order ~107 KWD),
**geographic demand** across 113 areas, and **kitchen volume forecasting** from the deep schedule
history.

## What AI skills can we build now?
Safely, today: **Customer 360**, **Customer Segmentation**, **Churn/Win-back scoring**, **Package
(tier) Recommendation**, **Menu/Demand Intelligence**, **Kitchen Volume Forecasting**, a masked
**Customer-Service Copilot**, and a deterministic **Exception-Repair Assistant**.

## What is blocked by missing data?
Anything **dish-specific or health-specific**: personalized meal recommendations, nutrition-aware
planning, allergy-safe automation, diet compliance, and delivery-quality/driver analytics. These are
blocked by **missing data, not by technology** — no model can compensate for data we never captured.

## What should Nutrezee capture next?
One keystone above all: **record which dish each customer gets each day** (link the daily plan to the
menu). Then **delivery outcomes**, **allergies/diet** (with consent), **dish nutrition**, and
**customer feedback**. Capturing the dish link alone roughly doubles our "auto-meal readiness."

## What is the safest first AI feature?
**Customer 360 + Segmentation + Churn/Win-back**, delivered as read-only internal tools. It creates
immediate marketing and retention value, exposes no new risk, and builds the data views every future AI
skill will reuse.

## What is the long-term AI vision?
A staged path to an **auto meal planner**: (1) behavioral recommendations now → (2) plan-level
auto-suggestions as we capture dish + feedback → (3) personalized, nutrition-aware, allergy-safe
meal planning once dish/nutrition/allergy/inventory data accumulates. Auto-meal readiness today is
**~27/100**; the dish-capture program is what moves it toward production-grade personalization.
</content>
