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
ENV PORT=1024 \
    STREAM_PORT=2048 \
    DATA_DIR=/data \
    CONFIG_DIR=/config \
    MEDIA_DIR=/media \
    LOG_DIR=/logs \
    TZ=Asia/Shanghai
VOLUME ["/data", "/config", "/media", "/logs"]
EXPOSE 1024 2048
ENTRYPOINT ["/app/streampulse"]
