use base64::{engine::general_purpose::STANDARD, Engine};
use futures::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    io::{self, Write},
    net::SocketAddr,
    time::Duration,
};
use tokio::io::{AsyncBufReadExt, BufReader};
use tsclientlib::{Connection, DisconnectOptions, Identity, OutCommandExt, StreamItem};
use tsclientlib::{ChannelId, ChannelType};
use tsclientlib::{ClientId, MessageTarget, messages::c2s};
use tsclientlib::prelude::M2BClientMoveExt;
use std::collections::HashMap;
use tsproto_packets::packets::{
    AudioData, CodecType, Direction, Flags, OutAudio, OutCommand, PacketType,
};

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum Control {
    Disconnect,
    Command { request_id: u32, command: ClientCommand },
    AudioState {
        input_muted: bool,
        output_muted: bool,
    },
    Audio {
        codec: u8,
        data: String,
    },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum ClientCommand {
    JoinChannel { channel_id: u64, password: Option<String> },
    Subscribe { channel_id: u64, subscribed: bool },
    Nickname { name: String },
    Away { away: bool, message: String },
    TextMessage { target: String, channel_id: Option<u64>, client_id: Option<u16>, client_uid: Option<String>, message: String },
    Poke { client_id: u16, client_uid: Option<String>, message: String },
}

fn client_command(connection: &mut Connection, action: ClientCommand) -> Result<tsclientlib::MessageHandle, ()> {
    let recipient = match &action {
        ClientCommand::TextMessage { client_id: Some(id), client_uid: Some(uid), .. } | ClientCommand::Poke { client_id: id, client_uid: Some(uid), .. } => Some((*id, uid)),
        _ => None,
    };
    if let Some((id, expected)) = recipient {
        let state = connection.get_state().map_err(|_| ())?;
        if state.clients.get(&ClientId(id)).and_then(|client| client.uid.as_ref()).map(|uid| uid.to_string()).as_ref() != Some(expected) { return Err(()); }
    }
    let command = match action {
        ClientCommand::JoinChannel { channel_id, password } => {
            let state = connection.get_state().map_err(|_| ())?;
            let own = state.clients.get(&state.own_client).ok_or(())?;
            let mut part = own.client_move(ChannelId(channel_id));
            if let Some(ref password) = password { part = part.set_password(password); }
            c2s::OutClientMoveMessage::new(&mut std::iter::once(part))
        }
        ClientCommand::Subscribe { channel_id, subscribed } => {
            let mut command = OutCommand::new(Direction::C2S, Flags::empty(), PacketType::Command, if subscribed { "channelsubscribe" } else { "channelunsubscribe" });
            command.write_arg("cid", &channel_id); command
        }
        ClientCommand::Nickname { name } => {
            if name.is_empty() || name.chars().count() > 64 { return Err(()); }
            let mut command = OutCommand::new(Direction::C2S, Flags::empty(), PacketType::Command, "clientupdate");
            command.write_arg("client_nickname", &name); command
        }
        ClientCommand::Away { away, message } => {
            let mut command = OutCommand::new(Direction::C2S, Flags::empty(), PacketType::Command, "clientupdate");
            command.write_arg("client_away", &(away as u8)); command.write_arg("client_away_message", &message); command
        }
        ClientCommand::TextMessage { target, channel_id, client_id, message, .. } => {
            if message.len() > 1000 { return Err(()); }
            if target == "channel" {
                let state = connection.get_state().map_err(|_| ())?;
                if state.clients.get(&state.own_client).map(|client| client.channel.0) != channel_id { return Err(()); }
            }
            let target = match target.as_str() { "channel" => MessageTarget::Channel, "server" => MessageTarget::Server, "private" => MessageTarget::Client(ClientId(client_id.ok_or(())?)), _ => return Err(()) };
            connection.get_state().map_err(|_| ())?.send_message(target, &message)
        }
        ClientCommand::Poke { client_id, message, .. } => {
            connection.get_state().map_err(|_| ())?.send_message(MessageTarget::Poke(ClientId(client_id)), &message)
        }
    };
    command.send_with_result(connection).map_err(|_| ())
}

fn audio_status(connection: &Connection) -> io::Result<()> {
    emit(
        json!({"type":"audio_status", "canSend":connection.can_send_audio(), "canReceive":connection.can_receive_audio()}),
    )
}

fn control(connection: &mut Connection, control: Control, pending: &mut HashMap<u16, u32>) -> Result<bool, ()> {
    match control {
        Control::Disconnect => return Ok(false),
        Control::Command { request_id, command } => {
            if pending.len() >= 64 { emit(json!({"type":"client_command_result","requestId":request_id,"ok":false})).map_err(|_| ())?; }
            else {
                match client_command(connection, command) {
                    Ok(handle) => { pending.insert(handle.0, request_id); },
                    Err(()) => { emit(json!({"type":"client_command_result","requestId":request_id,"ok":false,"code":"command_not_sent"})).map_err(|_| ())?; },
                }
            }
        }
        Control::AudioState {
            input_muted,
            output_muted,
        } => {
            if (input_muted || output_muted) && connection.can_send_audio() {
                let _ = connection.send_audio(OutAudio::new(&AudioData::C2S {
                    id: 0,
                    codec: CodecType::OpusVoice,
                    data: &[],
                }));
            }
            let mut command = OutCommand::new(
                Direction::C2S,
                Flags::empty(),
                PacketType::Command,
                "clientupdate",
            );
            command.write_arg("client_input_muted", &(input_muted as u8));
            command.write_arg("client_output_muted", &(output_muted as u8));
            command.write_arg("client_input_hardware", &1);
            command.write_arg("client_output_hardware", &1);
            command.send_with_result(connection).map_err(|_| ())?;
            audio_status(connection).map_err(|_| ())?;
        }
        Control::Audio { codec, data } => {
            // The upstream send_audio warns but does not enforce this permission itself.
            if !connection.can_send_audio() {
                return Ok(true);
            }
            let codec = match codec {
                4 => CodecType::OpusVoice,
                5 => CodecType::OpusMusic,
                _ => return Err(()),
            };
            let data = STANDARD.decode(data).map_err(|_| ())?;
            if data.len() > 1275 {
                return Err(());
            }
            let state = connection.get_state().map_err(|_| ())?;
            let own = state.clients.get(&state.own_client).ok_or(())?;
            let channel = state.channels.get(&own.channel).ok_or(())?;
            if channel.codec as u8 != codec as u8 {
                return Ok(true);
            }
            connection
                .send_audio(OutAudio::new(&AudioData::C2S {
                    id: 0,
                    codec,
                    data: &data,
                }))
                .map_err(|_| ())?;
        }
    }
    Ok(true)
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Generate,
    Import {
        value: String,
    },
    Inspect {
        identity: Identity,
    },
    Export {
        identity: Identity,
    },
    Connect {
        identity: Identity,
        address: SocketAddr,
        nickname: String,
        password: Option<String>,
        channel_id: Option<u64>,
        channel_password: Option<String>,
        seconds: u64,
    },
}

fn emit(value: Value) -> io::Result<()> {
    let mut out = io::stdout().lock();
    serde_json::to_writer(&mut out, &value)?;
    out.write_all(b"\n")?;
    out.flush()
}
fn metadata(identity: &Identity) -> Value {
    json!({"uid": identity.key().to_pub().get_uid(), "level": identity.level()})
}
fn private_identity(identity: &Identity) -> io::Result<()> {
    // Private stdio protocol. The Node adapter must encrypt this and never forward it.
    emit(json!({"type":"identity_internal", "identity":identity, "metadata":metadata(identity)}))
}
fn error_code(error: &tsclientlib::Error) -> &'static str {
    match error {
        tsclientlib::Error::ConnectTs(_) => "server_rejected_connection",
        tsclientlib::Error::IdentityLevel(_) => "identity_level_required",
        tsclientlib::Error::ServerUidMismatch(_) => "server_identity_changed",
        tsclientlib::Error::InitserverTimeout => "server_initialization_timeout",
        tsclientlib::Error::ConnectFailed { .. } => "connection_failed",
        tsclientlib::Error::CommandError(_) => "server_permission_or_command_error",
        tsclientlib::Error::ConnectionFailed(cause) | tsclientlib::Error::SendPacket(cause) => match cause {
            tsproto::client::Error::TsProto(cause) => match cause {
                tsproto::Error::NotInReceiveWindow { .. } => "packet_receive_window_exceeded",
                tsproto::Error::WrongMac { .. } => "packet_authentication_failed",
                tsproto::Error::DecompressPacket(_) => "packet_decompression_failed",
                tsproto::Error::MaxLengthExceeded("command queue") => "command_reorder_capacity_exceeded",
                tsproto::Error::MaxLengthExceeded("fragment queue") => "fragment_capacity_exceeded",
                tsproto::Error::MaxLengthExceeded(_) => "packet_capacity_exceeded",
                tsproto::Error::Network(_) => "protocol_network_error",
                tsproto::Error::PacketParse(_, _) => "packet_parse_failed",
                tsproto::Error::WrongClientId(_) => "packet_client_id_mismatch",
                tsproto::Error::UnexpectedInitPacket => "unexpected_initialization_packet",
                tsproto::Error::UnallowedUnencryptedPacket => "unencrypted_packet_rejected",
                _ => "protocol_packet_error",
            },
            tsproto::client::Error::ConnectionEnd => "server_connection_ended",
            _ => "protocol_connection_failed",
        },
        tsclientlib::Error::Io(_) => "protocol_io_error",
        tsclientlib::Error::ConnectionGone => "server_connection_ended",
        _ => "protocol_error",
    }
}
fn snapshot(connection: &Connection, sequence: u64) -> Option<Value> {
    let state = connection.get_state().ok()?;
    if state.channels.len() > 4096 || state.clients.len() > 4096 {
        return Some(json!({"type":"error", "code":"server_state_capacity_exceeded"}));
    }
    let channels: Vec<Value> = state
        .channels
        .values()
        .map(|channel| {
            json!({
                "id": channel.id.0, "parentId":channel.parent.0, "name":channel.name,
                "order": channel.order.0, "subscribed": channel.subscribed,
                "codec": channel.codec as u8,
                "passwordProtected": channel.has_password,
                "temporary": channel.channel_type == ChannelType::Temporary,
                "topic": channel.topic,
            })
        })
        .collect();
    let participants: Vec<Value> = state
        .clients
        .values()
        .map(|client| {
            json!({
                "id":client.id.0, "channelId":client.channel.0, "name":client.name,
                "uid":client.uid.as_ref().map(|uid| uid.to_string()),
                "inputMuted": client.input_muted, "outputMuted":client.output_muted,
                "awayMessage": client.away_message,
            })
        })
        .collect();
    Some(
        json!({"type":"state", "sequence":sequence, "server":{"name":state.server.name},
        "ownClientId":state.own_client.0, "channels":channels, "participants":participants}),
    )
}

async fn run() -> Result<(), ()> {
    let mut input = BufReader::new(tokio::io::stdin()).lines();
    let line = input.next_line().await.map_err(|_| ())?.ok_or(())?;
    if line.len() > 65536 {
        return Err(());
    }
    let request: Request = serde_json::from_str(&line).map_err(|_| ())?;
    match request {
        Request::Generate => {
            let mut identity = Identity::create();
            identity.upgrade_level(16);
            private_identity(&identity).map_err(|_| ())?;
        }
        Request::Import { value } => {
            if value.len() > 16384 {
                return Err(());
            }
            let identity = Identity::new_from_str(&value).map_err(|_| ())?;
            private_identity(&identity).map_err(|_| ())?;
        }
        Request::Inspect { identity } => {
            emit(json!({"type":"identity_metadata", "metadata":metadata(&identity)}))
                .map_err(|_| ())?;
        }
        Request::Export { identity } => {
            emit(json!({"type":"export_internal", "value":format!("{}V{}",identity.counter(),identity.key().to_ts_obfuscated())})).map_err(|_| ())?;
        }
        Request::Connect {
            identity,
            address,
            nickname,
            password,
            channel_id,
            channel_password,
            seconds,
        } => {
            if nickname.is_empty() || nickname.chars().count() > 64 || !(1..=240).contains(&seconds)
            {
                return Err(());
            }
            let mut options = Connection::build(address)
                .identity(identity)
                .name(nickname)
                .input_muted(true)
                .output_muted(true)
                .input_hardware_enabled(false)
                .output_hardware_enabled(false)
                .log_commands(false)
                .log_packets(false)
                .log_udp_packets(false);
            if let Some(password) = password {
                options = options.password(password);
            }
            if let Some(channel_id) = channel_id { options = options.channel_id(ChannelId(channel_id)); }
            if let Some(password) = channel_password { if password.len() > 256 { return Err(()); } options = options.channel_password(password); }
            let mut connection = options.connect().map_err(|_| ())?;
            emit(json!({"type":"status", "status":"connecting"})).map_err(|_| ())?;
            let lifetime = tokio::time::sleep(Duration::from_secs(seconds));
            let handshake = tokio::time::sleep(Duration::from_secs(25));
            tokio::pin!(lifetime, handshake);
            let mut connected = false;
            let mut sequence = 0u64;
            let mut pending_commands = HashMap::new();
            loop {
                tokio::select! {
                    _ = &mut lifetime => { emit(json!({"type":"status","status":"session_limit"})).map_err(|_| ())?; break; }
                    _ = &mut handshake, if !connected => { emit(json!({"type":"error","code":"handshake_timeout","inconclusive":true})).map_err(|_| ())?; break; }
                    command = input.next_line() => {
                        match command {
                            Ok(Some(line)) if line.len() <= 4096 => {
                                let command = serde_json::from_str::<Control>(&line).map_err(|_| ())?;
                                if !control(&mut connection, command, &mut pending_commands)? { break; }
                            }
                            _ => break,
                        }
                    }
                    event = async { connection.events().next().await } => {
                        match event {
                            Some(Ok(StreamItem::BookEvents(events))) => {
                                if !connected {
                                    connected = true;
                                    // Reconnection never re-enables audio without another owner action.
                                    control(&mut connection, Control::AudioState { input_muted: true, output_muted: true }, &mut pending_commands)?;
                                    emit(json!({"type":"status","status":"connected"})).map_err(|_| ())?;
                                    let subscribe = connection.get_state().map_err(|_| ())?.server.set_subscribed(true);
                                    if subscribe.send(&mut connection).is_err() {
                                        emit(json!({"type":"warning","code":"subscription_unavailable"})).map_err(|_| ())?;
                                    }
                                }
                                for event in events {
                                    if let tsclientlib::events::Event::Message { target, invoker, message } = event {
                                        let target_client_id = match target { MessageTarget::Client(id) | MessageTarget::Poke(id) => Some(id.0), _ => None };
                                        let target_uid = target_client_id.and_then(|id| connection.get_state().ok().and_then(|state| state.clients.get(&ClientId(id)).and_then(|client| client.uid.as_ref()).map(|uid| uid.to_string())));
                                        let target = match target { MessageTarget::Server => "server", MessageTarget::Channel => "channel", MessageTarget::Client(_) => "private", MessageTarget::Poke(_) => "poke" };
                                        let channel_id = connection.get_state().ok().and_then(|state| state.clients.get(&state.own_client).map(|client| client.channel.0));
                                        emit(json!({"type":"message","target":target,"clientId":invoker.id.0,"targetClientId":target_client_id,"uid":invoker.uid.as_ref().map(|uid| uid.to_string()),"targetUid":target_uid,"name":invoker.name,"message":message.chars().take(4096).collect::<String>(),"channelId":channel_id})).map_err(|_| ())?;
                                    }
                                }
                                sequence += 1;
                                if let Some(state) = snapshot(&connection, sequence) { emit(state).map_err(|_| ())?; }
                            }
                            Some(Ok(StreamItem::Audio(audio))) => {
                                let packet = audio.data();
                                let data = packet.data();
                                let (from, whisper) = match &data {
                                    AudioData::S2C { from, .. } => (*from, false),
                                    AudioData::S2CWhisper { from, .. } => (*from, true),
                                    _ => continue,
                                };
                                if data.data().len() <= 1275 {
                                    emit(json!({"type":"audio", "clientId":from, "sequence":data.id(), "codec":data.codec() as u8, "whisper":whisper, "data":STANDARD.encode(data.data())})).map_err(|_| ())?;
                                }
                            }
                            Some(Ok(StreamItem::AudioChange(_))) => { audio_status(&connection).map_err(|_| ())?; }
                            Some(Ok(StreamItem::MessageResult(handle, result))) => {
                                if let Some(request_id) = pending_commands.remove(&handle.0) {
                                    let server_error = result.as_ref().err().map(|error| error.error as u32);
                                    let missing_permission = result.as_ref().err().and_then(|error| error.missing_permission.map(|permission| permission.0));
                                    emit(json!({"type":"client_command_result", "requestId":request_id, "ok":result.is_ok(), "serverError":server_error,"missingPermission":missing_permission})).map_err(|_| ())?;
                                } else { emit(json!({"type":"command_result", "requestId":handle.0, "ok":result.is_ok()})).map_err(|_| ())?; }
                            }
                            Some(Ok(StreamItem::IdentityLevelIncreasing(level))) => {
                                emit(json!({"type":"status","status":"identity_level_increasing","requiredLevel":level})).map_err(|_| ())?;
                                if level > 24 { connection.cancel_identity_level_increase(); break; }
                            }
                            Some(Ok(StreamItem::IdentityLevelIncreased)) => {
                                if let Some(identity) = connection.get_options().get_identity() { private_identity(identity).map_err(|_| ())?; }
                            }
                            Some(Ok(StreamItem::DisconnectedTemporarily(_))) => {
                                connected = false;
                                emit(json!({"type":"status","status":"reconnecting"})).map_err(|_| ())?;
                                handshake.as_mut().reset(tokio::time::Instant::now()+Duration::from_secs(25));
                            }
                            Some(Err(error)) => {
                                emit(json!({"type":"error","code":error_code(&error)})).map_err(|_| ())?;
                                break;
                            }
                            None => break,
                            _ => {},
                        }
                    }
                }
            }
            if connection.disconnect(DisconnectOptions::new()).is_ok() {
                let _ = tokio::time::timeout(Duration::from_secs(1), async {
                    while connection.events().next().await.is_some() {}
                })
                .await;
            }
            emit(json!({"type":"status","status":"disconnected"})).map_err(|_| ())?;
        }
    }
    Ok(())
}
#[tokio::main]
async fn main() {
    // No tracing subscriber: protocol packets, keys and passwords never enter logs.
    if run().await.is_err() {
        let _ = emit(json!({"type":"error","code":"invalid_request_or_native_failure"}));
        std::process::exit(1);
    }
}
