# Repository UI conventions

- Reuse the project's custom form controls instead of native browser controls whenever an equivalent exists.
- Use `AppSelect.vue` for all user-facing dropdown/select fields. Do not introduce native `<select>` elements in feature UI.
- Use `DateTimePicker.vue` for date, time, and datetime fields. Do not introduce native date/time inputs.
- Before adding a new form control, search `meeting-minutes-vue/src/components` for an existing reusable component and keep interaction and styling consistent across views.
