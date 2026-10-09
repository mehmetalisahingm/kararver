// Üretimde kayıtlı olay tüketicileri — KV-21. Dağıtıcı (events.dispatch) yalnız bunlara teslim açar.
// Bir tüketici yalnız kayıt olduktan sonra dağıtılan olayları alır; geriye dönük teslim yoktur (docs/KV-21_NOTIFICATIONS.md §5.2).
import { createNotificationsConsumer } from "../notifications/consumer.ts";
import { assertConsumers, type EventConsumer } from "./consumers.ts";

export const productionConsumers: readonly EventConsumer[] = assertConsumers([createNotificationsConsumer()]);
