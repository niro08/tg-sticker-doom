#include "doomgeneric.h"
#include "doomkeys.h"
#include "m_argv.h"

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <unistd.h>

#define KEY_QUEUE_SIZE 64
#define COMMAND_BUFFER_SIZE 512
#define DEFAULT_ACTION_FRAMES 5
#define INITIAL_CAPTURE_FRAMES 40

static unsigned short key_queue[KEY_QUEUE_SIZE];
static unsigned int key_write_index = 0;
static unsigned int key_read_index = 0;

static char frame_path[PATH_MAX];
static char command_buffer[COMMAND_BUFFER_SIZE];
static size_t command_length = 0;
static unsigned long long frame_sequence = 0;

static unsigned char active_key = 0;
static int action_frames_remaining = 0;
static int capture_countdown = INITIAL_CAPTURE_FRAMES;

static void queue_key(int pressed, unsigned char key)
{
    unsigned int next_index = (key_write_index + 1) % KEY_QUEUE_SIZE;

    if (next_index == key_read_index)
    {
        fprintf(stderr, "headless bridge: key queue overflow\n");
        return;
    }

    key_queue[key_write_index] = (unsigned short) ((pressed << 8) | key);
    key_write_index = next_index;
}

static unsigned char action_key(const char *action)
{
    if (strcmp(action, "turn_left") == 0)
    {
        return KEY_LEFTARROW;
    }
    if (strcmp(action, "turn_right") == 0)
    {
        return KEY_RIGHTARROW;
    }
    if (strcmp(action, "forward") == 0)
    {
        return KEY_UPARROW;
    }
    if (strcmp(action, "fire") == 0)
    {
        return KEY_FIRE;
    }
    if (strcmp(action, "use") == 0)
    {
        return KEY_USE;
    }

    return 0;
}

static void write_frame(void)
{
    char temp_path[PATH_MAX];
    FILE *file;
    int flush_error;
    int sync_error;
    int close_error;
    int x;
    int y;

    if (frame_path[0] == '\0')
    {
        return;
    }

    if (snprintf(temp_path, sizeof(temp_path), "%s.tmp.%d", frame_path,
                 getpid()) >= (int) sizeof(temp_path))
    {
        fprintf(stderr, "headless bridge: frame path is too long\n");
        return;
    }

    file = fopen(temp_path, "wb");
    if (file == NULL)
    {
        fprintf(stderr, "headless bridge: cannot open frame file: %s\n",
                strerror(errno));
        return;
    }

    frame_sequence += 1;
    fprintf(file, "P6\n# sequence=%llu\n%d %d\n255\n", frame_sequence,
            DOOMGENERIC_RESX, DOOMGENERIC_RESY);

    for (y = 0; y < DOOMGENERIC_RESY; y += 1)
    {
        for (x = 0; x < DOOMGENERIC_RESX; x += 1)
        {
            uint32_t pixel = DG_ScreenBuffer[y * DOOMGENERIC_RESX + x];
            unsigned char rgb[3] = {
                (unsigned char) ((pixel >> 16) & 0xff),
                (unsigned char) ((pixel >> 8) & 0xff),
                (unsigned char) (pixel & 0xff),
            };
            fwrite(rgb, sizeof(rgb), 1, file);
        }
    }

    flush_error = fflush(file);
    sync_error = fsync(fileno(file));
    close_error = fclose(file);
    if (flush_error != 0 || sync_error != 0 || close_error != 0)
    {
        fprintf(stderr, "headless bridge: cannot flush frame file: %s\n",
                strerror(errno));
        unlink(temp_path);
        return;
    }

    if (rename(temp_path, frame_path) != 0)
    {
        fprintf(stderr, "headless bridge: cannot publish frame file: %s\n",
                strerror(errno));
        unlink(temp_path);
    }
}

static void handle_command(char *line)
{
    char action[32];
    int frames = DEFAULT_ACTION_FRAMES;
    unsigned char key;

    if (strcmp(line, "capture") == 0)
    {
        capture_countdown = 0;
        return;
    }
    if (strcmp(line, "quit") == 0)
    {
        exit(0);
    }

    if (sscanf(line, "%31s %d", action, &frames) < 1)
    {
        return;
    }

    key = action_key(action);
    if (key == 0)
    {
        fprintf(stderr, "headless bridge: unknown action: %s\n", action);
        return;
    }
    if (active_key != 0)
    {
        fprintf(stderr, "headless bridge: ignored action while busy: %s\n",
                action);
        return;
    }
    if (frames < 1)
    {
        frames = 1;
    }

    active_key = key;
    action_frames_remaining = frames;
    capture_countdown = -1;
    queue_key(1, active_key);
}

static void process_input(void)
{
    char incoming[128];
    ssize_t bytes_read;

    while ((bytes_read = read(STDIN_FILENO, incoming, sizeof(incoming))) > 0)
    {
        ssize_t index;

        for (index = 0; index < bytes_read; index += 1)
        {
            char character = incoming[index];

            if (character == '\n')
            {
                command_buffer[command_length] = '\0';
                handle_command(command_buffer);
                command_length = 0;
            }
            else if (character != '\r' &&
                     command_length + 1 < sizeof(command_buffer))
            {
                command_buffer[command_length] = character;
                command_length += 1;
            }
        }
    }

    if (bytes_read < 0 && errno != EAGAIN && errno != EWOULDBLOCK)
    {
        fprintf(stderr, "headless bridge: stdin read failed: %s\n",
                strerror(errno));
    }
}

void DG_Init(void)
{
    int frame_parameter;
    int flags;

    setvbuf(stdout, NULL, _IOLBF, 0);
    setvbuf(stderr, NULL, _IOLBF, 0);

    frame_parameter = M_CheckParmWithArgs("-framefile", 1);
    if (frame_parameter <= 0)
    {
        fprintf(stderr, "headless bridge: -framefile is required\n");
        exit(2);
    }

    if (snprintf(frame_path, sizeof(frame_path), "%s",
                 myargv[frame_parameter + 1]) >= (int) sizeof(frame_path))
    {
        fprintf(stderr, "headless bridge: frame path is too long\n");
        exit(2);
    }

    flags = fcntl(STDIN_FILENO, F_GETFL, 0);
    if (flags < 0 || fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK) < 0)
    {
        fprintf(stderr, "headless bridge: cannot configure stdin: %s\n",
                strerror(errno));
        exit(2);
    }
}

void DG_DrawFrame(void)
{
    process_input();

    if (active_key != 0)
    {
        action_frames_remaining -= 1;
        if (action_frames_remaining <= 0)
        {
            queue_key(0, active_key);
            active_key = 0;
            capture_countdown = 1;
        }
    }

    if (capture_countdown >= 0)
    {
        if (capture_countdown == 0)
        {
            write_frame();
            capture_countdown = -1;
        }
        else
        {
            capture_countdown -= 1;
        }
    }
}

void DG_SleepMs(uint32_t milliseconds)
{
    usleep(milliseconds * 1000);
}

uint32_t DG_GetTicksMs(void)
{
    struct timeval time;

    gettimeofday(&time, NULL);
    return (uint32_t) (time.tv_sec * 1000 + time.tv_usec / 1000);
}

int DG_GetKey(int *pressed, unsigned char *doom_key)
{
    unsigned short data;

    if (key_read_index == key_write_index)
    {
        return 0;
    }

    data = key_queue[key_read_index];
    key_read_index = (key_read_index + 1) % KEY_QUEUE_SIZE;
    *pressed = data >> 8;
    *doom_key = data & 0xff;
    return 1;
}

void DG_SetWindowTitle(const char *title)
{
}

int main(int argc, char **argv)
{
    doomgeneric_Create(argc, argv);

    while (1)
    {
        doomgeneric_Tick();
    }

    return 0;
}
