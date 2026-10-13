import { useState } from "react";
import { useFailedFormSubmissions, useRetryFormSubmission } from "@/api/forms";
import { Button } from "@/components/ui/button";
import { getApiErrorMessage } from "@/lib/apiError";
import { useAuthStore } from "@/store/authStore";

export function FailedFormSubmissions({
  formId,
  count,
}: {
  formId: string;
  count: number;
}) {
  const user = useAuthStore((state) => state.user);
  const canRecover = user?.role === "admin" || user?.role === "manager";
  const [offset, setOffset] = useState(0);
  const { data, isLoading, error, refetch } = useFailedFormSubmissions(
    formId,
    offset,
    canRecover,
  );
  const retry = useRetryFormSubmission(formId);
  const [message, setMessage] = useState("");
  const recover = async (submissionId: string): Promise<void> => {
    setMessage("");
    try {
      await retry.mutateAsync(submissionId);
      setMessage(
        "Lead created and workflow delivery scheduled. Confirmation emails were not resent.",
      );
      if ((data?.data.length ?? 0) === 1 && offset > 0)
        setOffset(Math.max(0, offset - 10));
    } catch (error) {
      setMessage(
        getApiErrorMessage(
          error,
          "Could not recover this submission. Try again shortly.",
        ),
      );
    }
  };
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
      <h2 className="font-semibold text-amber-950">
        {count} saved enquiries need lead recovery
      </h2>
      <p className="mt-2 text-sm text-amber-900">
        Their answers are saved, but a CRM lead could not be created.
      </p>
      {!canRecover ? (
        <p className="mt-3 text-sm text-amber-900">
          An admin or manager can retry these enquiries.
        </p>
      ) : (
        <>
          {isLoading && (
            <p role="status" className="mt-3 text-sm">
              Loading enquiries…
            </p>
          )}
          {error && (
            <div role="alert" className="mt-3">
              <p className="text-sm">
                {getApiErrorMessage(error, "Could not load saved enquiries")}
              </p>
              <Button variant="outline" onClick={() => void refetch()}>
                Try again
              </Button>
            </div>
          )}
          <div className="mt-4 divide-y divide-amber-200">
            {data?.data.map((submission) => (
              <div
                key={submission.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-amber-950">
                    {String(
                      submission.data.contact_name ||
                        submission.data.name ||
                        submission.data.email ||
                        "Website enquiry",
                    )}
                  </p>
                  <p className="mt-1 text-xs text-amber-900">
                    {new Date(submission.created_at).toLocaleString()}
                  </p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm text-amber-900">
                      View saved answers
                    </summary>
                    <dl className="mt-2 space-y-1 text-sm">
                      {Object.entries(submission.data).map(([key, value]) => (
                        <div key={key} className="break-words">
                          <dt className="font-medium">{key}</dt>
                          <dd>{String(value ?? "")}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </div>
                <Button
                  disabled={retry.isPending}
                  onClick={() => void recover(submission.id)}
                >
                  {retry.isPending && retry.variables === submission.id
                    ? "Recovering…"
                    : "Retry lead creation"}
                </Button>
              </div>
            ))}
          </div>
          {count > 10 && (
            <div className="mt-3 flex gap-2">
              <Button
                variant="outline"
                disabled={offset === 0 || retry.isPending}
                onClick={() => setOffset(Math.max(0, offset - 10))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                disabled={offset + 10 >= count || retry.isPending}
                onClick={() => setOffset(offset + 10)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm text-amber-950">
          {message}
        </p>
      )}
    </section>
  );
}
