import Foundation

/// Hands a result to one waiter, once: whichever of the work and the timer gets there first.
private final class Once<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var waiter: CheckedContinuation<Result<T, Error>?, Never>?

    init(_ waiter: CheckedContinuation<Result<T, Error>?, Never>) {
        self.waiter = waiter
    }

    /// True when this call was the one that answered.
    @discardableResult
    func answer(_ result: Result<T, Error>?) -> Bool {
        lock.lock()
        let w = waiter
        waiter = nil
        lock.unlock()
        w?.resume(returning: result)
        return w != nil
    }
}

/// `work`'s result, or nil if it hasn't ended after `seconds`. IrohLib's async calls can't be
/// cancelled, so the work carries on after a timeout; when it does end, `late` gets what it made, to
/// put it away (stop a stream nobody reads).
func withDeadline<T>(
    _ seconds: TimeInterval,
    _ work: @escaping () async throws -> T,
    late: @escaping (T) async -> Void = { _ in }
) async -> Result<T, Error>? {
    await withCheckedContinuation { waiter in
        let once = Once<T>(waiter)
        Task {
            do {
                let value = try await work()
                if !once.answer(.success(value)) {
                    await late(value)
                }
            } catch {
                once.answer(.failure(error))
            }
        }
        Task {
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            once.answer(nil)
        }
    }
}
