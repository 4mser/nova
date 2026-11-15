# Open questions · Earth → space transfer learning

Date: 14-11-2026. I use the same format as Benja's NASA data catalog (`datos/catalogo_nasa/CATALOGO.md` in his local
project folder, which is not in this repo): each question states what decision it is, what it unblocks and what is done
if there is no answer. I do not repeat the 12 questions of that catalog.

**Answers of 14-11-2026.** Benja answered all 22 and 4 more were added (23 to 26), which came out of the audit of the
third run. Each question carries its **Answer**; the *If you don't answer* stays as a record of the default option.
What was decided for the next run is summarized in the README, under "Next run (v4)".

I measured the LifeSnaps figures today on its daily table (`daily`, 7,410 rows).

## A. The 8 variables and the Earth data

> **Update (14-11, afternoon).** Benja asked to take the data from `datos/enviado_whatsapp/`. Batch 3 brings daily
> vital signs of 29 NASA bed-rest subjects, the Earth analog of microgravity. With that, questions 1, 2, 4, 5 and 6
> change. The previous version, which simulated space with the 8 variables of a watch, was discarded.

1. **Resolved: the 8 variables are those of bed rest.** They are `pulso`, `pa_sis`, `pa_dia`, `fr`, `temp`, `peso`,
   `diuresis` and `agua`, measured every morning by nursing staff. The first six are in the contract and in
   `nave/docs/umbrales.md`. SpO₂, HRV, sleep and mood are left out because bed rest does not include them. Note: water
   follows a daily protocol target, so it is the weakest of the 8. Do we change it? *If you don't answer:* it stays.

   **Answer:** for now, only pulse and blood pressure (`pulso`, `pa_sis` and `pa_dia`), with the real bed-rest data.
   v4 leaves out the other five; their results from the third run stay in the README as a reference.

2. **What does LifeSnaps contribute?** It pre-trains the daily dynamics of the forecasting model: 71 people and 7,410
   watch days (CC BY 4.0). It shares with bed rest only pulse, respiration and temperature, and measured with a
   different instrument: the watch, not nursing staff. That is why the control for plot 1 is done within bed rest
   (pre-bed-rest vs. bed rest, same people) and not against LifeSnaps. Pressure, weight and fluids appear on Earth only
   through each subject's pre-bed-rest period. *If you don't answer:* it stays as is.

   **Answer:** it stays, and v4 measures how much it contributes. Its eight channels stay in the shared pre-training;
   of the three v4 variables, only pulse (`resting_hr`) is also in LifeSnaps. Earth blood pressure comes from each
   subject's pre-bed-rest period.

3. **Daily or hourly granularity?** Bed rest is daily (one measurement per morning), so it stays daily: 14 days of
   context and 7 of horizon.

## B. Space data

4. **Resolved: space is −6° bed rest, with real data.** They are campaigns 1 and 3 and the CFT70 at UTMB (NLSP/LSDA,
   public NASA data): 10 to 21 pre-bed-rest days, 42 to 91 in bed (days with measured pulse) and up to 14
   post-bed-rest. Nothing is simulated except the anomalies injected to measure detection, and those are declared.

   **Answer:** the synthetic steps are kept, declared.

5. **Is there real flight data in the rest of the folder?** Batch 2 (NLSP heart rate and blood pressure) mostly brings
   summaries: plots, means and PDFs from Apollo, Shuttle and Mir, not individual daily series. In batch 1,
   `04_OSDR_astronautas_datanasa.zip` brings the Inspiration4 blood and urine tests (4 crew members, at L-92, L-44,
   L-3, R+1, R+45, R+82 and R+194) and bone studies in rodents: no daily in-flight vital signs either. To validate with
   real flight data they would have to be requested from LSDA (question 3 of the catalog). *If you don't answer:* the
   analog remains the only "space" source.

   **Answer:** they are not requested; bed rest is enough as an analog.

6. **How long is the "mission"?** Whatever each campaign has: 60 or 90 days in bed (42 to 70 in the CFT70). In the
   presentation it is told as the first 2 to 3 months of a mission, not as a 6-month flight.

   **Answer:** the first 2 to 3 months of a mission.

## C. Model and transfer learning

7. **Resolved: our own PatchTST as the base and Chronos-2 as a reference.** The PatchTST from `transformers` is trained
   on Earth (LifeSnaps and the pre-bed-rest period) and adapted to bed rest. Chronos-2 (`amazon/chronos-2`) runs
   without adaptation, only as a reference. The baselines are persistence and the mean of the last 7 days. If the
   baseline beats the network, it is reported as is (see the README).

8. **How far does adaptation go?** I follow the order of the project brief §6.2. Done: the residual corrector (the one
   that goes into the demo), the last layer with the backbone frozen, and full fine-tuning. Missing: LoRA (`peft`).
   *If you don't answer:* LoRA stays out, because full fine-tuning does not beat the 7-day mean.

   **Answer:** LoRA comes after v4, and only if full fine-tuning still beats the from-scratch model with the 3 seeds.
   Correction: the reason in the *If you don't answer* was wrong. Full fine-tuning does beat the 7-day mean (−0.014
   [−0.019; −0.008]); what remains to be known is whether it beats the model trained from scratch.

9. **Which variable leads the demo?** The project brief suggested pulse + HRV, but HRV is not in bed rest. Weight is the
   one that moves the most (−1.3 kg, about twice its day-to-day variation). *If you don't answer:* weight + pulse.

   **Answer:** blood pressure + pulse. It was weight + pulse at first, but weight was left out of v4. Note: in the third
   run, pulse and pressure change with bed rest considerably less than weight (see the README table).

10. **Does radiation enter the corrector as a covariate or only as a correlation analysis?** This was already open in
    the project brief §11 and depends on what Daniella delivers (question 20). In bed rest there is no radiation and no
    spacecraft CO₂, so it cannot be tested with this data. *If you don't answer:* it stays designed as a covariate
    (daily dose) for when there is ship data, not built.

    **Answer:** designed as an input to the corrector, not built.

## D. Kaggle and Hugging Face

11. **Resolved by default: how does the Hugging Face token reach Kaggle?** Your HF token is fine-grained and can write
    to the `Benjjaman` repos (I checked today). The Kaggle CLI (2.2.4) has no command for secrets, so there are two
    paths:
    - **a.** You add, once, an `HF_TOKEN` secret in Kaggle (Add-ons → Secrets), and the notebook uploads the weights on
      its own.
    - **b.** The notebook leaves the weights in its output and I upload them to HF from the PC with
      `kaggle kernels output`. On the PC only files are copied; no network runs.

    *If you don't answer:* (b).

12. **Are the HF repos private or public?** They are `Benjjaman/nova-tierra` (base model) and `Benjjaman/nova-espacio`
    (adapted). There is no synthetic dataset anymore. *If you don't answer:* private.

    **Answer:** private for now and public at the end of the hackathon, after correcting their model cards with what
    the audit found.

## E. How it fits into NOVA

13. **Where does the model run on board?** NOVA works without internet and already brings up its models as local
    services: language on :8081, voice on :8082, hearing on :8083, search on :8084 and vision on :8792, all supervised
    by `servicios.rs`. There are two options:
    - **a.** One more Python service, the forecasting one (for example on :8793), which reads `/v1/historia` and returns
      predictions.
    - **b.** Export the model to ONNX and run it inside the link, in Rust.

    Either one changes `nave/`, which Nicolás Moreno integrates. *If you don't answer:* (a), designed and documented in
    this branch. The change to `nave/` goes in a separate PR, after discussing it with him.

    **Answer:** (a), a local Python service on :8793.

14. **Is adaptation done on board or on Earth?** The residual corrector is a few coefficients and can be refitted every
    day on board, without waiting for Earth. The base model is improved on Earth with the nightly reports and returns to
    the ship as a package signed with ed25519 (`aprende.rs`), which today only carries notes and corrected answers. It
    is the "Earth → ship distillation" that your folder and the pitch leave as pending.
    *If you don't answer:* the corrector is refitted on board every day and the base weights arrive by signed package.
    The latter stays designed, not built today.

    **Answer:** the corrector is refitted on board and the base model arrives from Earth, as in the default option.

15. **Does the adapted model define the `ESPERADO_VUELO` range?** `umbrales.md` leaves pending how to mark when a change
    is what is expected in microgravity. The "new normal" of the adapted model (the prediction with its interval) could
    be that range: if a variable leaves the interval N consecutive days, attention is flagged. The fixed emergency
    thresholds are not touched, because the repo rule says that critical logic lives in fixed rules.
    *If you don't answer:* yes, as a proposal to review with Nicolás Moreno.

    **Answer:** not for now. The adapted range is not proposed as `ESPERADO_VUELO`.

16. **Does the forecast replace the Vitals cone?** *If you don't answer:* I do not touch `vitals.js`. The daily forecast
    goes separately, as a 7-day trend.

    **Answer:** no; it goes separately.

17. **What do we pass to Ask NOVA?** The explanation layer of the project brief §6.4 receives a JSON with predictions,
    anomalies and covariates. Ask NOVA already exists (`nova.rs`, `cerebro.rs`). *If you don't answer:* I leave the
    JSON format in this branch and Ask NOVA reads it later, without touching its code today.

    **Answer:** the connection with Ask NOVA is done by Nicolás Moreno.

18. **Do we add `diuresis` and `agua` to the contract?** The contract does not have them and says that a new sensor "is
    added to this table before using it". Proposal: `diuresis` (`g/dia`) and `agua` (`g/dia`), logged by the crew in
    the app. *If you don't answer:* I use them with those names in this branch and propose them to Nicolás Moreno in the
    PR, without touching the contract.

    **Answer:** not needed for now. v4 uses only `pulso`, `pa_sis` and `pa_dia`, which are already in the contract.

## F. Team

19. **Luis: which of the 8 variables does the physical station measure?** Decides what arrives through the station
    (NDJSON contract) and what through the phone and the watch. *If you don't answer:* what the station already
    measures (pulse and temperature) arrives through it; pressure, respiration, weight, urine output and water are
    logged on the phone.

    **Answer:** Nicolás Moreno defines it.

20. **Daniella: which radiation series do we use and in which unit?** The covariate needs the daily dose (mGy/day or
    mSv/day) and a solar event flag. *If you don't answer:* I use the estimated dose the ship already computes
    (`dosisMision()` in `vitals.js`) plus the DONKI 2024 events (question 4 of the catalog).

    **Answer:** Luis has to be asked, since he is the one who handles radiation. It stays pending; it does not block
    v4, because the covariate is designed and not built (question 10).

21. **Ambar: can mood enter the model?** In NOVA, mood only comes from the phone if the person shares their day, so the
    model has to work without it. LifeSnaps does include it, with its participants' consent; bed rest does not. *If you
    don't answer:* it stays out of the 8 and is proposed as an optional variable later.

    **Answer:** out, as an optional variable later.

## G. Delivery

22. **Do I push the branch and open the PR to `4mser/nova`?** The repo belongs to 4mser and Nicolás Moreno integrates
    it, so I do not merge. *If you don't answer:* I push nothing until you tell me.

    **Answer:** the branch was pushed on 14-11-2026 and the PR to `main` is opened with the README already corrected.
    Nicolás Moreno integrates it; I do not merge. v4 goes in a separate PR.

## H. What the audit of the third run left

23. **Is the forecast repeated with several seeds?** With a single seed, full fine-tuning beats the from-scratch model
    by −0.0038 [−0.0064; −0.0011], but the models were trained under different conditions. The from-scratch ones used
    lr 1e-3 and a 60-epoch cap. Full fine-tuning used lr 2e-4 and a 30-epoch cap, and "head only", lr 1e-3 and a
    30-epoch cap. "Head only" was cut off by the cap in 3 of 5 folds.

    **Answer:** yes, in v4, with 3 seeds and all models under equal conditions: same lr and budget, and a cap of 60
    epochs or more for "head only".

24. **Does "head only" really freeze the backbone?** `congelar_backbone` turns off the gradients, but the model trains
    in `train()` mode: BatchNorm is recomputed on bed rest and dropout stays active. Between `nova-tierra` and
    `nova-espacio`, 20 of 71 tensors change, 18 of them BatchNorm.

    **Answer:** truly freeze it (backbone in `eval()`) and compare it with the current version.

25. **Is the forecast adapted to each person?** Today it is adapted to the bed rest of the training subjects; the
    evaluated subject contributes none of their own days.

    **Answer:** yes, with their first k = 7, 14 and 28 days in bed.

26. **Is the range width one for the whole population or one per person?** Today the 5 % false-alarm rate holds on
    average: for weight, 18 of 29 people have none and one reaches 40.7 %.

    **Answer:** try a per-person width and compare it with the population width.
