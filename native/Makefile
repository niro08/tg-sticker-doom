CC ?= clang
DOOM_DIR := ../vendor/doomgeneric/doomgeneric
OBJ_DIR := build
BIN_DIR := bin
OUTPUT := $(BIN_DIR)/doomgeneric-headless

CFLAGS ?= -O2
CFLAGS += -std=c11 -Wall -Wextra -Wno-unused-parameter
CFLAGS += -DNORMALUNIX -D_DEFAULT_SOURCE -I$(DOOM_DIR)
LDLIBS += -lm

DOOM_SOURCES := \
	dummy.c am_map.c doomdef.c doomstat.c dstrings.c d_event.c d_items.c \
	d_iwad.c d_loop.c d_main.c d_mode.c d_net.c f_finale.c f_wipe.c \
	g_game.c hu_lib.c hu_stuff.c info.c i_cdmus.c i_endoom.c i_joystick.c \
	i_scale.c i_sound.c i_system.c i_timer.c memio.c m_argv.c m_bbox.c \
	m_cheat.c m_config.c m_controls.c m_fixed.c m_menu.c m_misc.c \
	m_random.c p_ceilng.c p_doors.c p_enemy.c p_floor.c p_inter.c \
	p_lights.c p_map.c p_maputl.c p_mobj.c p_plats.c p_pspr.c p_saveg.c \
	p_setup.c p_sight.c p_spec.c p_switch.c p_telept.c p_tick.c p_user.c \
	r_bsp.c r_data.c r_draw.c r_main.c r_plane.c r_segs.c r_sky.c \
	r_things.c sha1.c sounds.c statdump.c st_lib.c st_stuff.c s_sound.c \
	tables.c v_video.c wi_stuff.c w_checksum.c w_file.c w_main.c w_wad.c \
	z_zone.c w_file_stdc.c i_input.c i_video.c doomgeneric.c

DOOM_OBJECTS := $(addprefix $(OBJ_DIR)/,$(DOOM_SOURCES:.c=.o))
BRIDGE_OBJECT := $(OBJ_DIR)/doomgeneric_headless.o

.PHONY: all clean

all: $(OUTPUT)

$(OUTPUT): $(DOOM_OBJECTS) $(BRIDGE_OBJECT) | $(BIN_DIR)
	$(CC) $(CFLAGS) $^ -o $@ $(LDLIBS)

$(OBJ_DIR)/%.o: $(DOOM_DIR)/%.c | $(OBJ_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

$(BRIDGE_OBJECT): doomgeneric_headless.c | $(OBJ_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

$(OBJ_DIR) $(BIN_DIR):
	mkdir -p $@

clean:
	rm -rf $(OBJ_DIR) $(BIN_DIR)
