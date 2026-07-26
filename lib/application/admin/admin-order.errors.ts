export class AdminOrderListError extends Error {
  constructor(message = "Admin orders could not be loaded.") {
    super(message);
    this.name = "AdminOrderListError";
  }
}
