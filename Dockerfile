# syntax=docker/dockerfile:1
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags "-s -w" -o /out/streampulse ./cmd/server

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=build /out/streampulse /app/streampulse
ENV PORT=6060 \
    STREAM_PORT=6086 \
    DATA_DIR=/data \
    CONFIG_DIR=/config \
    MEDIA_DIR=/media \
    LOG_DIR=/logs \
    TZ=Asia/Shanghai
VOLUME ["/data", "/config", "/media", "/logs"]
EXPOSE 6060 6086
ENTRYPOINT ["/app/streampulse"]
