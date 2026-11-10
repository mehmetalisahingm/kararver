export function GET(request: Request) {
  return Response.redirect(new URL("/experiences/cabin/index.html", request.url), 307);
}
